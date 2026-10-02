// index.html 主逻辑

// State
let assetUnit = 'yuan';
let debtUnit = 'yuan';
let nisabUnit = 'yuan';
const DRAFT_SCHEMA_VERSION = 1;

const assetCurrencyIds = ['cash', 'tradeGoods', 'stocks', 'realEstate', 'receivables'];
const debtCurrencyIds = ['personalDebt', 'mortgage', 'carLoan', 'creditCard', 'otherDebt', 'annualBasicExpenses'];
const nisabCurrencyIds = ['nisabThreshold'];
const FETCH_COOLDOWN = 30000;
let lastFetchTime = 0;
let isFetchingPrices = false;

// Auto-save
document.addEventListener('input', (e) => {
    if (e.target.tagName.toLowerCase() === 'input' && (e.target.type === 'number' || e.target.type === 'checkbox')) {
        clearAlert();
        saveDraft();
    }
});

function saveDraft() {
    const inputs = document.querySelectorAll('input[type="number"]');
    const draft = { schemaVersion: DRAFT_SCHEMA_VERSION };
    inputs.forEach(input => draft[input.id] = input.value);
    draft.hawlConfirmed = document.getElementById('hawlConfirmed')?.checked || false;
    draft.assetUnit = assetUnit;
    draft.debtUnit = debtUnit;
    draft.nisabUnit = nisabUnit;
    safeSetItem('zakatDraftV2', JSON.stringify(draft));
}

window.addEventListener('DOMContentLoaded', () => {
    const draftRaw = localStorage.getItem('zakatDraftV2');
    if (draftRaw) {
        try {
            const draft = JSON.parse(draftRaw);
            const inputs = document.querySelectorAll('input[type="number"]');
            inputs.forEach(input => {
                if (draft[input.id] !== undefined) {
                    input.value = draft[input.id];
                }
            });
            const hawlCheckbox = document.getElementById('hawlConfirmed');
            if (hawlCheckbox) hawlCheckbox.checked = !!draft.hawlConfirmed;
            if (draft.assetUnit === 'wan') switchUnit('asset', 'wan');
            if (draft.debtUnit === 'wan') switchUnit('debt', 'wan');
            if (draft.nisabUnit === 'wan') switchUnit('nisab', 'wan');
        } catch (e) { }
    }
    fetchPrices();
});

// Unit switcher
function switchUnit(section, unit) {
    let currentUnit, ids, toggleId;
    if (section === 'asset') {
        currentUnit = assetUnit; ids = assetCurrencyIds; toggleId = 'assetUnitToggle';
    } else if (section === 'debt') {
        currentUnit = debtUnit; ids = debtCurrencyIds; toggleId = 'debtUnitToggle';
    } else {
        currentUnit = nisabUnit; ids = nisabCurrencyIds; toggleId = 'nisabUnitToggle';
    }
    if (unit === currentUnit) return;
    const factor = unit === 'wan' ? 0.0001 : 10000;

    ids.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        const val = parseFloat(input.value) || 0;
        if (val !== 0) {
            input.value = parseFloat((val * factor).toPrecision(10));
        }
    });

    if (section === 'asset') assetUnit = unit;
    else if (section === 'debt') debtUnit = unit;
    else nisabUnit = unit;

    const toggleEl = document.getElementById(toggleId);
    toggleEl.querySelectorAll('.unit-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.unit === unit);
        btn.setAttribute('aria-pressed', String(btn.dataset.unit === unit));
    });

    const unitLabel = unit === 'wan' ? '万元' : '元';
    ids.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        const wrapper = input.closest('.input-wrapper');
        const unitSpan = wrapper?.querySelector('.unit-display');
        if (unitSpan) unitSpan.textContent = unitLabel;
    });

    saveDraft();
}

function autoCalcNisab() {
    const silverPrice = getVal('silverPrice');
    if (silverPrice <= 0) {
        showAlert('请先获取或填写白银价格，再自动计算起征点。');
        document.getElementById('silverPrice').focus();
        return;
    }
    clearAlert();
    const nisab = roundMoney(612.36 * silverPrice);
    document.getElementById('nisabThreshold').value = nisabUnit === 'wan' ? nisab / 10000 : nisab;
    saveDraft();
}

// Fetch prices
async function fetchPrices() {
    if (isFetchingPrices) return;
    const btn = document.getElementById('fetchBtn');
    const statusEl = document.getElementById('priceStatus');
    const now = Date.now();
    if (now - lastFetchTime < FETCH_COOLDOWN) {
        statusEl.className = 'price-status loading show';
        statusEl.textContent = '价格刚刚更新，请稍后再试。';
        return;
    }
    lastFetchTime = now;
    isFetchingPrices = true;
    btn.disabled = true;
    btn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg> 获取中...';

    statusEl.className = 'price-status loading show';
    statusEl.textContent = '正在获取实时国际金银价格...';

    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await requestPrices();
                return;
            } catch (err) {
                if (attempt === 0) {
                    statusEl.textContent = '获取失败，2 秒后重试...';
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    statusEl.className = 'price-status error show';
                    statusEl.textContent = '⚠ 获取失败，请手动输入价格 (' + err.message + ')';
                    lastFetchTime = 0;
                }
            }
        }
    } finally {
        isFetchingPrices = false;
        btn.disabled = false;
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg> 获取实时价格';
    }
}

async function requestPrices() {
    const statusEl = document.getElementById('priceStatus');
    const [goldRes, silverRes] = await Promise.all([
        fetch('https://api.gold-api.com/price/XAU'),
        fetch('https://api.gold-api.com/price/XAG')
    ]);

    if (!goldRes.ok || !silverRes.ok) throw new Error('API 请求失败');

    const goldData = await goldRes.json();
    const silverData = await silverRes.json();

    const fxRes = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!fxRes.ok) throw new Error('汇率获取失败');
    const fxData = await fxRes.json();
    const usdToCny = fxData.rates.CNY;

    const troyOzToGram = 31.1035;
    const goldPriceCnyGram = (goldData.price * usdToCny) / troyOzToGram;
    const silverPriceCnyGram = (silverData.price * usdToCny) / troyOzToGram;

    document.getElementById('goldPrice').value = goldPriceCnyGram.toFixed(2);
    document.getElementById('silverPrice').value = silverPriceCnyGram.toFixed(2);
    saveDraft();

    const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    statusEl.className = 'price-status success show';
    statusEl.textContent = '✓ 价格已更新（' + timeStr + '）· 汇率 1 USD = ' + usdToCny.toFixed(4) + ' CNY';
}

function showAlert(message) {
    const alertEl = document.getElementById('formAlert');
    alertEl.textContent = message;
    alertEl.classList.add('show');
}

function clearAlert() {
    const alertEl = document.getElementById('formAlert');
    alertEl.classList.remove('show');
}

function getVal(id) {
    return sanitizeNumber(document.getElementById(id).value);
}

function toYuan(val, unit) {
    return unit === 'wan' ? val * 10000 : val;
}

// Calculate
function calculateAndNavigate() {
    clearAlert();

    const hawlConfirmed = document.getElementById('hawlConfirmed').checked;
    if (!hawlConfirmed) {
        showAlert('请先确认应课资产已满一个阴历年（Hawl）后再计算。');
        document.getElementById('hawlConfirmed').focus();
        return;
    }

    const nisabInputRaw = getVal('nisabThreshold');
    if (nisabInputRaw <= 0) {
        showAlert('请先填写有效的天课起征点金额（需大于 0）。');
        document.getElementById('nisabThreshold').focus();
        return;
    }

    const silverPrice = getVal('silverPrice');
    const goldPrice = getVal('goldPrice');
    const goldWeight = getVal('goldWeight');
    const silverWeight = getVal('silverWeight');

    if (goldWeight > 0 && goldPrice <= 0) {
        showAlert('已填写黄金重量，请先填写有效黄金价格。');
        document.getElementById('goldPrice').focus();
        return;
    }
    if (silverWeight > 0 && silverPrice <= 0) {
        showAlert('已填写白银重量，请先填写有效白银价格。');
        document.getElementById('silverPrice').focus();
        return;
    }

    const cash = toYuan(getVal('cash'), assetUnit);
    const tradeGoods = toYuan(getVal('tradeGoods'), assetUnit);
    const stocks = toYuan(getVal('stocks'), assetUnit);
    const realEstate = toYuan(getVal('realEstate'), assetUnit);
    const receivables = toYuan(getVal('receivables'), assetUnit);

    const personalDebt = toYuan(getVal('personalDebt'), debtUnit);
    const mortgage = toYuan(getVal('mortgage'), debtUnit);
    const carLoan = toYuan(getVal('carLoan'), debtUnit);
    const creditCard = toYuan(getVal('creditCard'), debtUnit);
    const otherDebt = toYuan(getVal('otherDebt'), debtUnit);
    const annualBasicExpenses = toYuan(getVal('annualBasicExpenses'), debtUnit);

    const nisabThreshold = roundMoney(toYuan(nisabInputRaw, nisabUnit));

    const goldValue = roundMoney(goldWeight * goldPrice);
    const silverValue = roundMoney(silverWeight * silverPrice);

    const totalAssets = safeAdd(cash, goldValue, silverValue, tradeGoods, stocks, realEstate, receivables);
    const totalDebts = safeAdd(personalDebt, mortgage, carLoan, creditCard, otherDebt, annualBasicExpenses);
    const netWealth = roundMoney(totalAssets - totalDebts);

    const isAboveNisab = netWealth >= nisabThreshold;
    const zakatDue = isAboveNisab ? roundMoney(netWealth * 0.025) : 0;

    const resultData = {
        schemaVersion: 1,
        hawlConfirmed,
        silverPrice,
        goldPrice,
        nisabThreshold,
        assets: {
            cash,
            goldWeight,
            goldValue,
            silverWeight,
            silverValue,
            tradeGoods,
            stocks,
            realEstate,
            receivables
        },
        debts: {
            personalDebt,
            mortgage,
            carLoan,
            creditCard,
            otherDebt,
            annualBasicExpenses
        },
        totalAssets,
        totalDebts,
        netWealth,
        isAboveNisab,
        zakatDue,
        calculatedAt: new Date().toISOString()
    };

    safeSetItem('zakatResultV2', JSON.stringify(resultData));
    window.location.href = './result.html';
}

// Reset
function resetForm() {
    if (assetUnit === 'wan') switchUnit('asset', 'yuan');
    if (debtUnit === 'wan') switchUnit('debt', 'yuan');
    if (nisabUnit === 'wan') switchUnit('nisab', 'yuan');
    document.querySelectorAll('input[type="number"]').forEach(input => {
        if (input.id === 'silverPrice' || input.id === 'goldPrice' || input.id === 'nisabThreshold') {
            input.value = '';
        } else {
            input.value = '0';
        }
    });
    document.getElementById('hawlConfirmed').checked = false;
    clearAlert();
    document.getElementById('priceStatus').classList.remove('show');
    localStorage.removeItem('zakatDraftV2');
    fetchPrices();
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.target.closest('input, button, a, select, textarea')) calculateAndNavigate();
});

// Focus helpers
document.addEventListener('focusin', (e) => {
    if (e.target.matches('input[type="number"]') && e.target.value === '0') {
        e.target.value = '';
    }
});

document.addEventListener('focusout', (e) => {
    if (e.target.matches('input[type="number"]') && e.target.value === '') {
        if (!['silverPrice', 'goldPrice', 'nisabThreshold'].includes(e.target.id)) {
            e.target.value = '0';
        }
    } else if (e.target.matches('input[type="number"]')) {
        const sanitized = sanitizeNumber(e.target.value);
        e.target.value = sanitized === 0 ? '0' : String(sanitized);
    }
    if (e.target.matches('input[type="number"]')) saveDraft();
});

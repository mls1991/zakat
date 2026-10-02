'use strict';

const C = ZakatCalculator;
const DRAFT_KEY = 'zakatDraftV2';
let draft = C.emptyDraft();
let storageAvailable = true;
let requestController;
let lastFetchTime = 0;
let fetchingPrices = false;
const FETCH_COOLDOWN = 30000;
const priceRevisions = { gold: 0, silver: 0 };
const byId = id => document.getElementById(id);
const unitFor = id => Object.keys(C.groups).find(group => C.groups[group].includes(id));

function saveDraft() {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        byId('saveStatus').textContent = '已自动保存到本机';
        storageAvailable = true;
    } catch (_) {
        storageAvailable = false;
        byId('saveStatus').textContent = '此浏览器无法保存草稿，请勿关闭页面';
    }
}

function renderUnit(group) {
    const unit = draft.units[group];
    const toggle = byId(group + 'UnitToggle');
    toggle.querySelectorAll('button').forEach(button => {
        const active = button.dataset.unit === unit;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    C.groups[group].forEach(id => {
        const input = byId(id);
        const value = Number((draft.values[id] / C.factor(unit)).toPrecision(15));
        input.value = value || '';
        input.closest('.input-wrapper').querySelector('.unit').textContent = unit === 'wan' ? '万元' : '元';
    });
}

function updateSummary() {
    const result = C.calculate(draft.values, draft.hawlConfirmed);
    byId('summaryAssets').textContent = C.fmt(result.totalAssets);
    byId('summaryDebts').textContent = C.fmt(result.totalDebts);
    const net = result.netWealth.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    byId('summaryNet').textContent = net;
    byId('mobileNet').textContent = net;
    byId('priceBadge').textContent = draft.values.goldPrice > 0 && draft.values.silverPrice > 0 ? '价格已就绪' : '可手动填写';
    for (const [id, keys] of Object.entries({ metalsTotal: ['goldWeight', 'silverWeight'], investmentsTotal: C.groups.asset.filter(id => id !== 'cash'), debtsTotal: C.groups.debt })) {
        byId(id).textContent = keys.some(key => draft.values[key] > 0) ? '已填写' : '选填';
    }
    const reference = C.roundMoney(612.36 * draft.values.silverPrice);
    byId('useSilverReference').disabled = !(reference > 0);
    byId('nisabReference').textContent = reference > 0
        ? `612.36 克 × ${C.fmt(draft.values.silverPrice)} 元/克 = ${C.fmt(reference)} 元。仅在点击采用后填写。`
        : '获取或填写白银价格后，可计算 612.36 克白银的参考值。';
    for (const metal of ['gold', 'silver']) {
        const price = draft.prices[metal];
        const time = price.updatedAt && !Number.isNaN(Date.parse(price.updatedAt))
            ? new Date(price.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        byId(metal + 'PriceSource').textContent = price.source === 'manual'
            ? '手动价格 · 自动更新不会覆盖' : draft.values[metal + 'Price'] > 0 ? `参考价${time ? ' · 获取于 ' + time : ''}` : '等待参考价，也可手动填写';
    }
}

function clearFieldError(id) {
    byId(id).removeAttribute('aria-invalid');
    byId(id + 'Error').textContent = '';
}

function fieldError(id, message) {
    const input = byId(id);
    let parent = input.parentElement;
    while (parent) {
        if (parent.tagName === 'DETAILS') parent.open = true;
        parent = parent.parentElement;
    }
    input.setAttribute('aria-invalid', 'true');
    byId(id + 'Error').textContent = message;
    input.focus({ preventScroll: true });
    input.closest('.form-group, .hawl-section').scrollIntoView({ block: 'center', behavior: 'instant' });
    return false;
}

function readInput(id) {
    const input = byId(id);
    const value = Number(input.value);
    const group = unitFor(id);
    const yuan = value * (group ? C.factor(draft.units[group]) : 1);
    if (input.validity.badInput || !Number.isFinite(yuan) || value < 0 || Math.abs(yuan) > Number.MAX_SAFE_INTEGER / 100 / C.fields.length) {
        return fieldError(id, '请输入有效的非负数，金额不能超出可计算范围。');
    }
    draft.values[id] = C.moneyFields.includes(id) ? C.roundMoney(yuan) : yuan;
    return true;
}

function switchUnit(group, unit) {
    if (draft.units[group] === unit) return;
    if (!C.groups[group].every(readInput)) return;
    draft.units[group] = unit;
    renderUnit(group);
    saveDraft();
    updateSummary();
}

function useSilverReference() {
    const reference = C.roundMoney(612.36 * draft.values.silverPrice);
    if (!(reference > 0)) return;
    draft.values.nisabThreshold = reference;
    draft.nisabSource = 'silverReference';
    renderUnit('nisab');
    clearFieldError('nisabThreshold');
    saveDraft();
    updateSummary();
    byId('nisabApplied').textContent = `已采用 ${C.fmt(reference)} 元参考值，可按当地学者指导修改。`;
}

async function fetchPrices(force = false) {
    if (fetchingPrices) return;
    if (force && ['gold', 'silver'].some(metal => draft.prices[metal].source === 'manual' && draft.values[metal + 'Price'] > 0)
        && !window.confirm('更新参考价格将替换已填写的手动金银价格，是否继续？')) return;
    if (!force && ['gold', 'silver'].every(metal => draft.prices[metal].source === 'manual')) {
        byId('priceStatus').textContent = '已保留手动价格。需要实时参考价时，可点击更新。';
        return;
    }
    if (force && Date.now() - lastFetchTime < FETCH_COOLDOWN) {
        byId('priceStatus').textContent = '参考价格刚刚更新，请稍后再试。';
        return;
    }
    lastFetchTime = Date.now();
    fetchingPrices = true;
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    const revisions = { ...priceRevisions };
    byId('fetchBtn').disabled = true;
    byId('fetchBtn').textContent = '正在更新…';
    byId('priceStatus').textContent = '正在获取金银价格与人民币汇率…';
    byId('priceStatus').className = 'price-status loading show';
    try {
        let data;
        for (let attempt = 0; attempt < 2; attempt++) {
            const attemptController = new AbortController();
            const onAbort = () => attemptController.abort();
            controller.signal.addEventListener('abort', onAbort);
            const timer = setTimeout(() => attemptController.abort(), 10000);
            try {
                const urls = ['https://api.gold-api.com/price/XAU', 'https://api.gold-api.com/price/XAG', 'https://open.er-api.com/v6/latest/USD'];
                data = await Promise.all(urls.map(async url => {
                    const response = await fetch(url, { signal: attemptController.signal, cache: 'no-store' });
                    if (!response.ok) throw new Error('价格服务暂不可用');
                    return response.json();
                }));
                if (![data[0].price, data[1].price, data[2].rates?.CNY].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) throw new Error('价格数据无效');
                break;
            } catch (error) {
                if (controller.signal.aborted || attempt === 1) throw error;
                byId('priceStatus').textContent = '获取失败，2 秒后重试…';
                await new Promise(resolve => setTimeout(resolve, 2000));
                if (controller.signal.aborted) return;
            } finally {
                clearTimeout(timer);
                controller.signal.removeEventListener('abort', onAbort);
            }
        }
        const [gold, silver, fx] = data;
        const converted = [gold, silver].map(response => C.roundMoney(response.price * fx.rates.CNY / 31.1035));
        if (!converted.every(value => value > 0 && value <= Number.MAX_SAFE_INTEGER / 100 / C.fields.length)) throw new Error('价格数据无效');
        if (controller !== requestController) return;
        for (const [metal, value] of [['gold', converted[0]], ['silver', converted[1]]]) {
            // A manual edit made while this request was pending always wins.
            if (revisions[metal] === priceRevisions[metal] && (force || draft.prices[metal].source !== 'manual')) {
                draft.values[metal + 'Price'] = value;
                draft.prices[metal] = { source: 'live', updatedAt: new Date().toISOString() };
                byId(metal + 'Price').value = value;
                clearFieldError(metal + 'Price');
            }
        }
        saveDraft();
        updateSummary();
        byId('priceStatus').className = 'price-status success show';
        byId('priceStatus').textContent = '参考价格已更新，已填写的起征点保持不变。';
    } catch (_) {
        if (controller !== requestController) return;
        if (!controller.signal.aborted) lastFetchTime = 0;
        byId('priceStatus').className = 'price-status error show';
        byId('priceStatus').textContent = '暂时无法更新参考价，已保留现有价格。您可以手动填写或稍后重试。';
    } finally {
        if (controller === requestController) {
            fetchingPrices = false;
            byId('fetchBtn').disabled = false;
            byId('fetchBtn').textContent = '更新参考价格';
        }
    }
}

function calculateAndNavigate(event) {
    event?.preventDefault();
    if (!C.fields.every(readInput)) return;
    if (draft.values.nisabThreshold <= 0) return fieldError('nisabThreshold', '请填写起征点金额，或点击采用白银参考值。');
    for (const metal of ['gold', 'silver']) {
        if (draft.values[metal + 'Weight'] > 0 && draft.values[metal + 'Price'] <= 0)
            return fieldError(metal + 'Price', `已填写${metal === 'gold' ? '黄金' : '白银'}重量，请填写有效的每克价格。`);
    }
    for (const metal of ['gold', 'silver']) {
        const value = draft.values[metal + 'Weight'] * draft.values[metal + 'Price'];
        if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER / 100 / C.fields.length)
            return fieldError(metal + 'Weight', '贵金属市值超出可计算范围，请核对重量与价格。');
    }
    draft.hawlConfirmed = byId('hawlConfirmed').checked;
    if (!draft.hawlConfirmed) return fieldError('hawlConfirmed', '请先确认应课资产已满一个阴历年（Hawl）。');
    const result = { ...C.calculate(draft.values, draft.hawlConfirmed), calculatedAt: new Date().toISOString() };
    try {
        localStorage.setItem('zakatResultV2', JSON.stringify(result));
    } catch (_) {
        byId('formAlert').textContent = '此浏览器未允许保存计算结果，请允许本站使用本地存储后重试。';
        byId('formAlert').hidden = false;
        byId('formAlert').scrollIntoView({ block: 'center' });
        return;
    }
    saveDraft();
    window.location.href = './result.html';
}

function resetForm() {
    if (!window.confirm('清空本机保存的填写内容和计算结果？此操作无法撤销。')) return;
    requestController?.abort();
    fetchingPrices = false;
    lastFetchTime = 0;
    draft = C.emptyDraft();
    for (const metal of ['gold', 'silver']) priceRevisions[metal]++;
    try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem('zakatResultV2'); } catch (_) { /* status is updated below */ }
    C.fields.forEach(id => { byId(id).value = ''; clearFieldError(id); });
    Object.keys(C.groups).forEach(renderUnit);
    byId('hawlConfirmed').checked = false;
    clearFieldError('hawlConfirmed');
    byId('nisabApplied').textContent = '';
    byId('draftNotice').hidden = true;
    byId('formAlert').hidden = true;
    document.querySelectorAll('details').forEach(details => details.open = false);
    byId('saveStatus').textContent = storageAvailable ? '填写内容保存在本机，不会上传' : '此浏览器无法保存草稿';
    updateSummary();
    byId('cash').focus({ preventScroll: true });
    byId('assetsCard').scrollIntoView({ block: 'start' });
    fetchPrices();
}

try {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
        const raw = JSON.parse(saved);
        draft = C.restoreDraft(raw);
        if (raw && raw.schemaVersion !== 2 && ['assetUnit', 'debtUnit', 'nisabUnit'].some(key => raw[key] === 'wan')) byId('draftNotice').hidden = false;
        byId('saveStatus').textContent = '已恢复本机草稿，请核对金额';
    }
} catch (_) {
    byId('saveStatus').textContent = '草稿无法读取，请重新填写';
}
Object.keys(C.groups).forEach(renderUnit);
for (const id of C.fields.filter(id => !unitFor(id))) byId(id).value = draft.values[id] || '';
byId('hawlConfirmed').checked = draft.hawlConfirmed;
document.querySelectorAll('details').forEach(details => {
    if ([...details.querySelectorAll('input')].some(input => draft.values[input.id] > 0)) details.open = true;
});
updateSummary();

document.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('input', () => {
        clearFieldError(input.id);
        if (!readInput(input.id)) return;
        if (input.id === 'goldPrice' || input.id === 'silverPrice') {
            const metal = input.id === 'goldPrice' ? 'gold' : 'silver';
            draft.prices[metal] = { source: 'manual', updatedAt: null };
            priceRevisions[metal]++;
        }
        if (input.id === 'nisabThreshold') {
            draft.nisabSource = 'manual';
            byId('nisabApplied').textContent = '';
        }
        saveDraft();
        updateSummary();
    });
});
byId('hawlConfirmed').addEventListener('change', () => {
    clearFieldError('hawlConfirmed');
    draft.hawlConfirmed = byId('hawlConfirmed').checked;
    saveDraft();
});
document.querySelectorAll('[data-group][data-unit]').forEach(button => button.addEventListener('click', () => switchUnit(button.dataset.group, button.dataset.unit)));
byId('useSilverReference').addEventListener('click', useSilverReference);
byId('fetchBtn').addEventListener('click', () => fetchPrices(true));
byId('resetBtn').addEventListener('click', resetForm);
byId('calculatorForm').addEventListener('submit', calculateAndNavigate);
fetchPrices();

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

function calculator() {
    const ids = ['silverPrice', 'goldPrice', 'nisabThreshold', 'formAlert', 'fetchBtn', 'priceStatus', 'hawlConfirmed'];
    const elements = Object.fromEntries(ids.map(id => [id, {
        id, value: '', className: '', textContent: '', innerHTML: '', disabled: false,
        focus() { this.focused = true; },
        classList: { add() {}, remove() {} },
        closest() { return { querySelector() { return null; } }; },
        setAttribute(name, value) { this[name] = value; }
    }]));
    elements.nisabUnitToggle = { querySelectorAll: () => [] };
    const listeners = {}, storage = {}, requests = [];
    let time = 100000, timer;
    let respond = async url => ({ ok: true, json: async () => url.includes('latest') ? { rates: { CNY: 7 } } : { price: 31.1035 } });
    const context = {
        console,
        Date: class extends Date { static now() { return time; } },
        setTimeout: fn => { timer = fn; },
        document: {
            getElementById: id => elements[id],
            querySelectorAll: () => ids.slice(0, 3).map(id => elements[id]),
            addEventListener: (event, fn) => { listeners[event] = fn; }
        },
        window: { addEventListener() {} },
        localStorage: { setItem: (key, value) => { storage[key] = value; } },
        fetch: async url => { requests.push(url); return respond(url); }
    };
    vm.createContext(context);
    vm.runInContext(source('js/utils.js'), context);
    vm.runInContext(source('js/app.js'), context);
    return {
        context, elements, listeners, storage, requests,
        advance: ms => { time += ms; },
        retry: () => timer(),
        respondWith: fn => { respond = fn; }
    };
}

test('auto nisab needs a price, converts units and saves the existing draft format', () => {
    const app = calculator();
    app.context.autoCalcNisab();
    assert.equal(app.elements.silverPrice.focused, true);
    assert.equal(app.elements.nisabThreshold.value, '');
    app.elements.silverPrice.value = '10';
    app.context.autoCalcNisab();
    assert.equal(app.elements.nisabThreshold.value, 6123.6);
    assert.equal(JSON.parse(app.storage.zakatDraftV2).nisabThreshold, 6123.6);
    app.context.switchUnit('nisab', 'wan');
    app.context.autoCalcNisab();
    assert.equal(app.elements.nisabThreshold.value, 0.61236);
    assert.equal(JSON.parse(app.storage.zakatDraftV2).nisabUnit, 'wan');
    assert.match(source('index.html'), /id="autoNisabBtn"[^>]*onclick="autoCalcNisab\(\)"/);
});

test('Enter in an input or control does not calculate', () => {
    const app = calculator();
    let count = 0;
    app.context.calculateAndNavigate = () => { count++; };
    for (const tag of ['input', 'button', 'a']) {
        app.listeners.keydown({ key: 'Enter', target: { closest: () => tag } });
    }
    assert.equal(count, 0);
    app.listeners.keydown({ key: 'Enter', target: { closest: () => null } });
    assert.equal(count, 1);
});

test('fetch succeeds, cools down, retries once, and permits manual retry after final failure', async () => {
    const app = calculator();
    await app.context.fetchPrices();
    assert.equal(app.requests.length, 3);
    assert.equal(app.elements.silverPrice.value, '7.00');
    await app.context.fetchPrices();
    assert.equal(app.requests.length, 3);
    app.advance(30000);
    let failures = 0;
    app.respondWith(async url => {
        if (failures++ === 0) throw Error('temporary');
        return { ok: true, json: async () => url.includes('latest') ? { rates: { CNY: 7 } } : { price: 31.1035 } };
    });
    let pending = app.context.fetchPrices();
    await new Promise(setImmediate);
    assert.equal(app.elements.fetchBtn.disabled, true);
    assert.match(app.elements.priceStatus.textContent, /重试/);
    app.retry();
    await pending;
    assert.equal(app.elements.fetchBtn.disabled, false);
    assert.match(app.elements.priceStatus.textContent, /已更新/);

    app.advance(30000);
    app.respondWith(async () => { throw Error('offline'); });
    pending = app.context.fetchPrices();
    await new Promise(setImmediate);
    app.retry();
    await pending;
    assert.equal(app.elements.fetchBtn.disabled, false);
    assert.match(app.elements.priceStatus.textContent, /手动输入/);
    const before = app.requests.length;
    app.respondWith(async url => ({ ok: true, json: async () => url.includes('latest') ? { rates: { CNY: 7 } } : { price: 31.1035 } }));
    await app.context.fetchPrices();
    assert.equal(app.requests.length, before + 3);
});

test('negative net wealth displays zero progress, a note, and red amounts', () => {
    const elements = { resultContainer: { innerHTML: '' }, footer: { style: {} } };
    const context = {
        console,
        document: { getElementById: id => elements[id] },
        localStorage: { getItem: () => JSON.stringify({ nisabThreshold: 1000, assets: { cash: 100 }, debts: { personalDebt: 200 }, hawlConfirmed: true }) },
        setTimeout() {}
    };
    vm.createContext(context);
    vm.runInContext(source('js/utils.js'), context);
    vm.runInContext(source('js/result.js'), context);
    assert.match(elements.resultContainer.innerHTML, /您的净资产为负，无需缴纳天课/);
    assert.match(elements.resultContainer.innerHTML, /<strong>0%<\/strong>/);
    assert.match(elements.resultContainer.innerHTML, /value net-wealth-negative">-100\.00 元/);
    assert.match(source('style.css'), /\.detail-row\.total \.value\.net-wealth-negative\s*\{\s*color: var\(--danger\)/);
});

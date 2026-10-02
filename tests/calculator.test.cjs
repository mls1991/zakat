const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calculator.js');

test('migrates all legacy amount groups without changing their yuan value', () => {
    const state = C.restoreDraft({ cash: '10', tradeGoods: '2', personalDebt: '1', nisabThreshold: '.6', assetUnit: 'wan', debtUnit: 'wan', nisabUnit: 'wan', goldWeight: '10', goldPrice: '600', silverPrice: '7', hawlConfirmed: true });
    assert.equal(state.values.cash, 100000);
    assert.equal(state.values.tradeGoods, 20000);
    assert.equal(state.values.personalDebt, 10000);
    assert.equal(state.values.nisabThreshold, 6000);
    assert.equal(state.values.goldWeight, 10);
    assert.equal(state.values.goldPrice, 600);
    assert.equal(state.prices.gold.source, 'manual');
    assert.equal(C.calculate(state.values, true).zakatDue, 2900);
});

test('canonical drafts survive repeated restore with yuan values unchanged', () => {
    let state = C.emptyDraft();
    state.values.cash = 100000.01;
    state.values.personalDebt = 10000;
    state.values.nisabThreshold = 6000;
    state.units = { asset: 'wan', debt: 'wan', nisab: 'wan' };
    for (let i = 0; i < 10; i++) state = C.restoreDraft(JSON.parse(JSON.stringify(state)));
    assert.equal(state.values.cash, 100000.01);
    assert.equal(state.values.personalDebt, 10000);
    assert.equal(state.values.nisabThreshold, 6000);
});

test('calculates the expected net wealth and zakat', () => {
    const result = C.calculate({ cash: 100000, personalDebt: 10000, nisabThreshold: 6000 }, true);
    assert.equal(result.netWealth, 90000);
    assert.equal(result.zakatDue, 2250);
});

test('includes metals, investments and all supported deductions', () => {
    const result = C.calculate({ cash: 100000, goldWeight: 10, goldPrice: 500, silverWeight: 100, silverPrice: 10, tradeGoods: 20000, stocks: 10000, realEstate: 30000, receivables: 5000, personalDebt: 10000, mortgage: 2000, carLoan: 1000, creditCard: 3000, otherDebt: 4000, annualBasicExpenses: 10000, nisabThreshold: 6000 }, true);
    assert.equal(result.totalAssets, 171000);
    assert.equal(result.totalDebts, 30000);
    assert.equal(result.netWealth, 141000);
    assert.equal(result.zakatDue, 3525);
});

test('treats equality, below-threshold wealth and negative net wealth correctly', () => {
    assert.equal(C.calculate({ cash: 6000, nisabThreshold: 6000 }, true).zakatDue, 150);
    assert.equal(C.calculate({ cash: 5999.99, nisabThreshold: 6000 }, true).zakatDue, 0);
    const result = C.calculate({ cash: 1000, personalDebt: 5000, nisabThreshold: 6000 }, true);
    assert.equal(result.netWealth, -4000);
    assert.equal(result.zakatDue, 0);
});

test('requires a positive threshold and Hawl confirmation for nonzero zakat', () => {
    assert.equal(C.calculate({ cash: 90000, nisabThreshold: 0 }, true).zakatDue, 0);
    assert.equal(C.calculate({ cash: 90000, nisabThreshold: 6000 }, false).zakatDue, 0);
});

test('rounds to cents and keeps fractional metal weights', () => {
    assert.equal(C.roundMoney(1.005), 1.01);
    const result = C.calculate({ cash: .1, stocks: .2, goldWeight: 1.234, goldPrice: 600, nisabThreshold: 1 }, true);
    assert.equal(result.assets.goldValue, 740.4);
    assert.equal(result.totalAssets, 740.7);
    assert.equal(result.zakatDue, 18.52);
});

test('preserves canonical manual price metadata', () => {
    const original = C.emptyDraft();
    original.values.goldPrice = 600;
    original.prices.gold = { source: 'manual', updatedAt: null };
    original.prices.silver = { source: 'live', updatedAt: '2026-10-02T03:00:00Z' };
    const restored = C.restoreDraft(original);
    assert.deepEqual(restored.prices, original.prices);
});

test('handles absent or malformed drafts and nonfinite inputs', () => {
    assert.deepEqual(C.restoreDraft(null), C.emptyDraft());
    assert.deepEqual(C.restoreDraft([]), C.emptyDraft());
    assert.equal(C.number(Infinity), 0);
    assert.equal(C.number(-1), 0);
    assert.equal(C.number('bad'), 0);
});

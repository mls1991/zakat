"""Run against a local static server: python3 tests/browser_smoke.py.
Set ZAKAT_BASE_URL to choose another server. APIs are mocked, not verified here.
"""
import json
import os
import unittest
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('ZAKAT_BASE_URL', 'http://127.0.0.1:8000/').rstrip('/') + '/'

class CalculatorBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        launch = {'executable_path': '/usr/bin/chromium', 'headless': True}
        if BASE.startswith('https://'):
            u = urlparse(os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy'))
            if u.hostname:
                proxy = {'server': f'{u.scheme}://{u.hostname}:{u.port}'}
                if u.username: proxy['username'] = u.username
                if u.password: proxy['password'] = u.password
                launch['proxy'] = proxy
        cls.browser = cls.playwright.chromium.launch(**launch)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844})
        self.context.route('https://fonts.googleapis.com/**', lambda route: route.abort())
        self.context.route('https://fonts.gstatic.com/**', lambda route: route.abort())
        self.context.route('https://api.gold-api.com/price/XAU', lambda route: route.fulfill(json={'price': 3100}))
        self.context.route('https://api.gold-api.com/price/XAG', lambda route: route.fulfill(json={'price': 31.1035}))
        self.context.route('https://open.er-api.com/**', lambda route: route.fulfill(json={'rates': {'CNY': 7}}))
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], 'Uncaught JavaScript errors')

    def visit(self):
        self.page.goto(BASE, wait_until='domcontentloaded')
        expect(self.page.locator('#fetchBtn')).to_be_enabled()

    def seed(self, draft):
        encoded = json.dumps(json.dumps(draft))
        self.context.add_init_script(f"if (!localStorage.getItem('zakatDraftV2')) localStorage.setItem('zakatDraftV2', {encoded});")

    def open_prices(self):
        if not self.page.locator('#pricesCard').evaluate('el => el.open'):
            self.page.locator('#pricesCard > summary').click()

    def fill_basic(self, cash='100000', debt='10000', threshold='6000'):
        self.page.locator('#cash').fill(cash)
        self.page.locator('#nisabThreshold').fill(threshold)
        self.page.locator('#debtsDetails > summary').click()
        self.page.locator('#personalDebt').fill(debt)
        self.page.locator('#hawlConfirmed').check()

    def test_legacy_drafts_restore_all_units_without_reconversion(self):
        self.seed({'schemaVersion': 1, 'cash': '10', 'personalDebt': '1', 'nisabThreshold': '.6', 'assetUnit': 'wan', 'debtUnit': 'wan', 'nisabUnit': 'wan', 'goldPrice': '600', 'silverPrice': '7', 'hawlConfirmed': True})
        self.visit()
        expect(self.page.locator('#draftNotice')).to_be_visible()
        for _ in range(3):
            expect(self.page.locator('#cash')).to_have_value('10')
            expect(self.page.locator('#personalDebt')).to_have_value('1')
            expect(self.page.locator('#nisabThreshold')).to_have_value('0.6')
            self.page.reload(wait_until='domcontentloaded')
        self.page.locator('#calculateBtn').click()
        self.page.wait_for_url('**/result.html')
        self.assertEqual(self.page.evaluate("JSON.parse(localStorage.getItem('zakatResultV2')).zakatDue"), 2250)

    def test_unit_switch_and_canonical_reload_preserve_cents(self):
        self.visit()
        for yuan, wan in [('100000.01', '10.000001'), ('1000000000000.01', '100000000.000001')]:
            self.page.locator('#cash').fill(yuan)
            for _ in range(3):
                self.page.locator('#assetUnitToggle [data-unit="wan"]').click()
                expect(self.page.locator('#cash')).to_have_value(wan)
                self.page.reload(wait_until='domcontentloaded')
                expect(self.page.locator('#cash')).to_have_value(wan)
                self.page.locator('#assetUnitToggle [data-unit="yuan"]').click()
                expect(self.page.locator('#cash')).to_have_value(yuan)
            saved = self.page.evaluate("JSON.parse(localStorage.getItem('zakatDraftV2'))")
            self.assertEqual(saved['schemaVersion'], 2)
            self.assertEqual(saved['values']['cash'], float(yuan))

    def test_reference_is_opt_in_and_remains_stable_when_price_changes(self):
        self.visit()
        expect(self.page.locator('#nisabThreshold')).to_have_value('')
        self.page.locator('#nisabUnitToggle [data-unit="wan"]').click()
        self.page.locator('#useSilverReference').click()
        expect(self.page.locator('#nisabThreshold')).to_have_value('0.428652')
        self.open_prices()
        self.page.locator('#silverPrice').fill('8')
        expect(self.page.locator('#nisabThreshold')).to_have_value('0.428652')
        expect(self.page.locator('#nisabReference')).to_contain_text('4,898.88')
        self.page.locator('#useSilverReference').click()
        expect(self.page.locator('#nisabThreshold')).to_have_value('0.489888')

    def test_manual_prices_survive_reload_and_explicit_refresh_needs_confirmation(self):
        self.visit()
        self.open_prices()
        self.page.locator('#goldPrice').fill('600')
        self.page.locator('#silverPrice').fill('9')
        self.page.reload(wait_until='domcontentloaded')
        expect(self.page.locator('#goldPrice')).to_have_value('600')
        expect(self.page.locator('#silverPrice')).to_have_value('9')
        self.page.once('dialog', lambda dialog: dialog.dismiss())
        self.page.locator('#fetchBtn').click()
        expect(self.page.locator('#goldPrice')).to_have_value('600')
        self.page.once('dialog', lambda dialog: dialog.accept())
        self.page.locator('#fetchBtn').click()
        expect(self.page.locator('#silverPrice')).to_have_value('7')
        expect(self.page.locator('#goldPrice')).to_have_value('697.67')

    def test_manual_edit_wins_over_pending_price_request(self):
        held = []
        self.page.route('https://api.gold-api.com/price/XAU', lambda route: held.append(route))
        self.page.goto(BASE, wait_until='domcontentloaded')
        self.open_prices()
        self.page.locator('#goldPrice').fill('600')
        self.assertEqual(len(held), 1)
        held[0].fulfill(json={'price': 3100})
        expect(self.page.locator('#fetchBtn')).to_be_enabled()
        expect(self.page.locator('#goldPrice')).to_have_value('600')
        expect(self.page.locator('#silverPrice')).to_have_value('7')

    def test_invalid_price_data_preserves_cached_values(self):
        self.seed({'schemaVersion': 2, 'values': {'goldPrice': 600, 'silverPrice': 7}, 'prices': {'gold': {'source': 'live'}, 'silver': {'source': 'live'}}})
        self.page.route('https://api.gold-api.com/price/XAU', lambda route: route.fulfill(json={'price': None}))
        self.visit()
        expect(self.page.locator('#goldPrice')).to_have_value('600')
        expect(self.page.locator('#silverPrice')).to_have_value('7')
        expect(self.page.locator('#priceStatus')).to_contain_text('已保留现有价格')

    def test_errors_are_next_to_focused_fields_and_open_hidden_sections(self):
        self.visit()
        self.page.locator('#calculateBtn').click()
        expect(self.page.locator('#nisabThresholdError')).to_contain_text('起征点')
        expect(self.page.locator('#nisabThreshold')).to_be_focused()
        error = self.page.locator('#nisabThresholdError').bounding_box()
        self.assertTrue(0 <= error['y'] < 844)
        self.page.locator('#nisabThreshold').fill('6000')
        self.page.locator('#calculateBtn').click()
        expect(self.page.locator('#hawlConfirmed')).to_be_focused()
        expect(self.page.locator('#hawlConfirmedError')).to_contain_text('Hawl')
        self.page.locator('#metalsDetails > summary').click()
        self.page.locator('#goldWeight').fill('10')
        self.open_prices()
        self.page.locator('#goldPrice').fill('')
        self.page.locator('#pricesCard > summary').click()
        self.page.locator('#calculateBtn').click()
        expect(self.page.locator('#goldPrice')).to_be_visible()
        expect(self.page.locator('#goldPriceError')).to_contain_text('黄金')

    def test_online_style_calculation_result_and_print_action(self):
        self.visit()
        self.fill_basic()
        self.page.locator('#calculateBtn').click()
        self.page.wait_for_url('**/result.html')
        expect(self.page.locator('.zakat-amount')).to_contain_text('2,250.00')
        expect(self.page.locator('.formula-note')).to_contain_text('90,000.00 元 × 2.5% = 2,250.00 元')
        expect(self.page.locator('.nisab-label')).to_contain_text('超出 84,000.00 元')
        self.page.evaluate('window.print = () => { window.printCalled = true; }')
        self.page.get_by_role('button', name='打印 / 保存 PDF').click()
        self.assertTrue(self.page.evaluate('window.printCalled'))
        self.page.get_by_role('link', name='修改填写').click()
        expect(self.page.locator('#cash')).to_have_value('100000')
        expect(self.page.locator('#personalDebt')).to_have_value('10000')

    def test_below_threshold_result_explains_zero(self):
        self.visit()
        self.fill_basic(cash='1000', debt='0')
        self.page.locator('#calculateBtn').click()
        self.page.wait_for_url('**/result.html')
        expect(self.page.locator('.zakat-amount')).to_contain_text('0.00')
        expect(self.page.locator('.nisab-label')).to_contain_text('还差 5,000.00 元')
        expect(self.page.locator('.formula-note')).to_contain_text('天课为 0 元')

    def test_reset_confirmation_and_persisted_data_removal(self):
        self.visit()
        self.page.locator('#cash').fill('100000')
        self.page.once('dialog', lambda dialog: dialog.dismiss())
        self.page.locator('#resetBtn').click()
        expect(self.page.locator('#cash')).to_have_value('100000')
        self.page.once('dialog', lambda dialog: dialog.accept())
        self.page.locator('#resetBtn').click()
        expect(self.page.locator('#cash')).to_have_value('')
        self.page.reload(wait_until='domcontentloaded')
        expect(self.page.locator('#cash')).to_have_value('')

    def test_storage_failure_is_reported_without_crashing(self):
        self.context.add_init_script("Storage.prototype.setItem = () => { throw new Error('storage disabled'); };")
        self.visit()
        self.fill_basic()
        expect(self.page.locator('#saveStatus')).to_contain_text('无法保存草稿')
        self.page.locator('#calculateBtn').click()
        expect(self.page.locator('#formAlert')).to_contain_text('未允许保存计算结果')
        self.assertFalse(self.page.url.endswith('result.html'))

    def test_mobile_and_desktop_layout_and_accessible_labels(self):
        self.visit()
        for width in [390, 320]:
            self.page.set_viewport_size({'width': width, 'height': 844})
            self.page.evaluate('window.scrollTo(0,0)')
            self.assertLess(self.page.locator('#cash').bounding_box()['y'], 844)
            expect(self.page.locator('#calculateBtn')).to_be_in_viewport()
            self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width)
        self.assertEqual(self.page.evaluate("[...document.querySelectorAll('input[type=number]')].filter(el => !el.labels.length).length"), 0)
        self.assertGreaterEqual(self.page.locator('.unit-btn').first.bounding_box()['height'], 44)
        self.page.set_viewport_size({'width': 1440, 'height': 1000})
        expect(self.page.locator('.summary-content')).to_be_visible()
        self.assertGreater(self.page.locator('.summary-panel').bounding_box()['x'], self.page.locator('.form-column').bounding_box()['x'])

    def test_missing_or_corrupted_results_have_recovery_actions(self):
        self.page.goto(BASE + 'result.html')
        expect(self.page.get_by_text('暂无计算数据', exact=True)).to_be_visible()
        self.page.evaluate("localStorage.setItem('zakatResultV2', '{broken')")
        self.page.reload()
        expect(self.page.get_by_text('结果数据损坏', exact=True)).to_be_visible()

if __name__ == '__main__':
    unittest.main(verbosity=2)

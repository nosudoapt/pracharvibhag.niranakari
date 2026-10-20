import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = "http://localhost:3000";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--window-size=1400,950"] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 950 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

// login
await page.goto(base + "/admin/login", { waitUntil: "networkidle2" });
await page.type("input[type=text]", "admin", { delay: 10 });
await page.type("input[type=password]", "change-me", { delay: 10 });
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 }).catch(() => {}),
  page.evaluate(() => document.querySelector("button[type=submit]")?.click()),
]);
await new Promise((r) => setTimeout(r, 16000));

const dash = await page.evaluate(() => ({
  url: location.pathname,
  pieTitle: [...document.querySelectorAll("h3")].some((h) => h.textContent.includes("Bal Mahila vs EMS")),
  pieLegend: [...document.querySelectorAll("span")].filter((x) => ["Mahila", "Bal", "EMS"].includes(x.textContent.trim())).length,
  zoneTitle: [...document.querySelectorAll("h3")].some((h) => h.textContent.includes("Zone completion")),
  doneBadges: [...document.querySelectorAll("span")].filter((x) => x.textContent.trim() === "Done").length,
  pendingBadges: [...document.querySelectorAll("span")].filter((x) => x.textContent.trim() === "Pending").length,
}));
await page.screenshot({ path: "/tmp/dash-1-dashboard.png" });

// gbm-ebm view: branch dropdown + checkboxes + delete flow
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("aside button, aside a")].find((b) => b.textContent.includes("Bal-Mahila-EMS"));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 14000));
const list = await page.evaluate(() => ({
  branchOptions: (document.querySelector('select[aria-label="Filter by branch"]') || {}).length || 0,
  rowCheckboxes: document.querySelectorAll('tbody input[type="checkbox"]').length,
  headerCheckbox: !!document.querySelector('thead input[type="checkbox"]'),
}));
// select first row
await page.click('tbody input[type="checkbox"]');
await new Promise((r) => setTimeout(r, 400));
const hasBtn = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Delete selected (1)")));
await page.screenshot({ path: "/tmp/dash-2-selected.png" });
// open modal
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Delete selected"))?.click());
await new Promise((r) => setTimeout(r, 500));
const modalUp = await page.evaluate(() => !!document.querySelector('input[type="password"][aria-label="Delete password"]'));
await page.type('input[type="password"][aria-label="Delete password"]', "totally-wrong", { delay: 5 });
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Delete permanently"))?.click());
await new Promise((r) => setTimeout(r, 2500));
const modalErr = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.textContent || "").includes("Wrong delete password"));
await page.screenshot({ path: "/tmp/dash-3-wrongpwd.png" });
// cancel — never delete real data
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel")?.click());
await new Promise((r) => setTimeout(r, 500));

console.log(JSON.stringify({ dash, list, hasBtn, modalUp, modalErr, errors }, null, 2));
await browser.close().catch(() => process.exit(0));

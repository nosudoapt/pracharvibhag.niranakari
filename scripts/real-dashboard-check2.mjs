import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = "http://localhost:3000";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--window-size=1400,950"] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 950 });
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(base + "/admin/login", { waitUntil: "networkidle2" });
await page.type("input[type=text]", "admin", { delay: 10 });
await page.type("input[type=password]", "change-me", { delay: 10 });
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 }).catch(() => {}),
  page.evaluate(() => document.querySelector("button[type=submit]")?.click()),
]);
await new Promise((r) => setTimeout(r, 16000)); // let stats+facets land

const dash = await page.evaluate(() => {
  const pieCard = [...document.querySelectorAll("h3")].find((h) => h.textContent.includes("Bal Mahila vs EMS"))?.parentElement;
  return {
    pieTotal: pieCard?.querySelector("svg text") ? [...pieCard.querySelectorAll("svg text")][0].textContent : null,
    pieItems: pieCard ? [...pieCard.querySelectorAll("span")].map((x) => x.textContent.trim()).filter((t) => /^\d+$/.test(t)).slice(0, 3) : [],
  };
});
await page.screenshot({ path: "/tmp/dash-4-pie.png" });

// gbm-ebm view
await page.evaluate(() => {
  [...document.querySelectorAll("aside button, aside a")].find((b) => b.textContent.includes("Bal-Mahila-EMS"))?.click();
});
await new Promise((r) => setTimeout(r, 12000));

const before = await page.evaluate(() => [...document.querySelectorAll("span")].find((x) => /\d+ results?/.test(x.textContent))?.textContent || "");

// open zone combo, type "delhi", pick Delhi NCR
const opened = await page.evaluate(() => {
  const combo = [...document.querySelectorAll("div")].find((d) => d.childElementCount === 2 && d.textContent.trim().startsWith("All zones"));
  combo?.click();
  return !!combo;
});
await new Promise((r) => setTimeout(r, 400));
await page.type('input[placeholder="Type to search…"]', "delhi", { delay: 20 });
await new Promise((r) => setTimeout(r, 500));
const picked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('div[role="button"], div')].filter((d) => d.textContent.trim().match(/^12 — Delhi NCR/));
  const el = [...document.querySelectorAll("div")].find((d) => d.getAttribute("role") === "button" && d.textContent.trim().startsWith("12 — Delhi NCR"));
  el?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  return !!el;
});
await new Promise((r) => setTimeout(r, 8000));
const after = await page.evaluate(() => [...document.querySelectorAll("span")].find((x) => /\d+ results?/.test(x.textContent))?.textContent || "");
const comboLabel = await page.evaluate(() => [...document.querySelectorAll("span")].find((x) => x.textContent.trim() === "12 — Delhi NCR (NCR)")?.textContent || [...document.querySelectorAll("span")].filter((x) => x.textContent.includes("12 — Delhi")).length);

const zoneRowsAll12 = await page.evaluate(() => {
  const cells = [...document.querySelectorAll("tbody td")].map((td) => td.textContent);
  return cells.some((t) => t.includes("Palwal")); // zone 12 is Delhi NCR — should be absent
});
await page.screenshot({ path: "/tmp/dash-5-zonefilter.png" });

console.log(JSON.stringify({ dash, opened, picked, before, after, zoneRowsAll12, errors }, null, 2));
await browser.close().catch(() => process.exit(0));

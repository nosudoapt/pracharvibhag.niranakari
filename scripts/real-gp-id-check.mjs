import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = "http://localhost:3000";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
const client = await page.createCDPSession();

// fresh state
await page.goto(base + "/admin/login", { waitUntil: "networkidle2" });
await client.send("Network.clearBrowserCookies");
await page.evaluate(() => sessionStorage.clear());

// 1) gp01 signs in through the unified door
await page.type("input[type=text]", "gp01", { delay: 15 });
await page.type("input[type=password]", "1111", { delay: 15 });
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 }).catch(() => {}),
  page.evaluate(() => document.querySelector("button[type=submit]")?.click()),
]);
await new Promise((r) => setTimeout(r, 8000));
const landed = await page.evaluate(() => ({
  url: location.pathname,
  badge: document.getElementById("modeBadge")?.textContent,
  loginShowing: !document.getElementById("loginScreen")?.classList.contains("hidden"),
  identity: JSON.parse(sessionStorage.getItem("gp_session_v1") || "null"),
}));

// 2) gp01 tries the admin dashboard
await page.goto(base + "/admin", { waitUntil: "networkidle2", timeout: 60000 });
const adminBounce = page.url();

// 3) gp01 tries an admin API
const api = await page.evaluate(async () => {
  const r = await fetch("/api/admin/submissions?limit=1");
  return r.status;
});
// 4) gp01 opens the GP page again — should boot straight in via cookie
await page.goto(base + "/gp-attendance.html", { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 6000));
const gpAgain = await page.evaluate(() => ({
  badge: document.getElementById("modeBadge")?.textContent,
  loginShowing: !document.getElementById("loginScreen")?.classList.contains("hidden"),
}));

console.log(JSON.stringify({ landed, adminBounce, adminApiStatus: api, gpAgain }, null, 2));
await browser.close().catch(() => process.exit(0));

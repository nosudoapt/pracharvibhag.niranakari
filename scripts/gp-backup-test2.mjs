import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
const client = await page.createCDPSession();
await page.setViewport({ width: 390, height: 844 });
await page.goto("http://localhost:3000/gp-attendance.html", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 6000));
await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); location.reload(); });
await new Promise((r) => setTimeout(r, 6000));
await page.type("#inUser", "gp01", { delay: 10 });
await page.type("#inPin", "1111", { delay: 10 });
await page.evaluate(() => [...document.querySelectorAll("#loginScreen button")].find((b) => b.textContent.match(/sign in/i))?.click());
await new Promise((r) => setTimeout(r, 12000));

// who is rid 130? search for them, mark them offline
const name = await page.evaluate(() => (DATA[129] || {}).name || "");
await page.evaluate(() => { const el = document.getElementById("q"); el.value = ""; });
await page.type("#q", name, { delay: 10 });
await new Promise((r) => setTimeout(r, 1200));
await client.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
const clickRes = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button.mark")].find((x) => x.dataset.rid === "130");
  if (!btn) return "NO BUTTON";
  btn.click();
  return "clicked";
});
await new Promise((r) => setTimeout(r, 1500));
const badge = await page.evaluate(() => document.getElementById("modeBadge")?.textContent);
const backupVisible = await page.evaluate(() => !document.getElementById("btnBackup")?.classList.contains("hidden"));
await page.evaluate(() => { document.getElementById("btnBackup").click(); });
await new Promise((r) => setTimeout(r, 800));
const modal = await page.evaluate(() => ({
  pre: document.getElementById("backupPre")?.textContent?.slice(0, 500),
}));
console.log(JSON.stringify({ name, clickRes, badge, backupVisible, modal }, null, 2));
await page.screenshot({ path: "/tmp/gp-backup-modal2.png" });
await browser.close().catch(() => process.exit(0));

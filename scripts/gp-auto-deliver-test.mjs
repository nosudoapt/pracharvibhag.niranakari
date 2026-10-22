import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = "http://localhost:3000";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
const client = await page.createCDPSession();

// login as gp01 (server marks rid 130 exist)
await page.goto(base + "/gp-attendance.html", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); location.reload(); });
await new Promise((r) => setTimeout(r, 6000));
const hasCard = await page.evaluate(() => !document.getElementById("loginScreen")?.classList.contains("hidden"));
if (hasCard) {
  await page.type("#inUser", "gp01", { delay: 10 });
  await page.type("#inPin", "1111", { delay: 10 });
  await page.evaluate(() => [...document.querySelectorAll("#loginScreen button")].find((b) => b.textContent.match(/sign in/i))?.click());
  await new Promise((r) => setTimeout(r, 12000));
}

// GO OFFLINE (CDP network emulation)
await client.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button.mark")].find((b) => b.dataset.rid === "9" && !b.classList.contains("undo"));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 1200));
const offlineState = await page.evaluate(() => ({
  badge: document.getElementById("modeBadge")?.textContent,
  marked5: !!mergedLog(9, selDate),
  bannerVisible: !document.getElementById("saveBanner")?.classList.contains("hidden"),
  bannerText: document.getElementById("saveBanner")?.textContent?.slice(0, 60),
  pending: JSON.parse(localStorage.getItem("gp_pending_v1") || "[]").length,
}));

// set a saved-listener to catch the beforeunload dialog
page.on("dialog", async (d) => { globalThis.dialogMsg = d.message(); await d.dismiss(); });

// BACK ONLINE — app should auto-deliver on next fetch
await client.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await page.evaluate(() => syncFromServer(false));
await new Promise((r) => setTimeout(r, 8000));
const backOnline = await page.evaluate(() => ({
  badge: document.getElementById("modeBadge")?.textContent,
  bannerVisible: !document.getElementById("saveBanner")?.classList.contains("hidden"),
  pendingLeft: JSON.parse(localStorage.getItem("gp_pending_v1") || "[]").length,
}));

// verify the mark actually reached the server now
const serverHas5 = await page.evaluate(async () => {
  const res = await fetch("/api/attendance/gp?date=" + selDate);
  const data = await res.json();
  return JSON.stringify((data.marks || []).find((m) => m.rid === 9) || null);
});

console.log(JSON.stringify({ offlineState, backOnline, serverHas5, exitDialog: globalThis.dialogMsg || null }, null, 2));
await browser.close().catch(() => process.exit(0));

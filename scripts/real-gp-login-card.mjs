import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = process.argv[2] || "http://localhost:3000/gp-attendance.html";
const users = [["gp01", "1111"], ["recorder1", "recorder123"], ["admin", "admin123"], ["wrong", "nope"]];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
const client = await page.createCDPSession();
const net = [];
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("response", (r) => { if (r.url().includes("/api/")) net.push(r.status() + " " + r.url().replace(base.split("/gp-")[0], "")); });

for (const [u, p] of users) {
  net.length = 0;
  await page.goto(base, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  // clear EVERYTHING so each user starts truly fresh
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await client.send("Network.clearBrowserCookies");
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 5000));
  const hasCard = await page.evaluate(() => !document.getElementById("loginScreen")?.classList.contains("hidden"));
  if (!hasCard) { console.log(JSON.stringify({ user: u, note: "no login card shown", net: [...new Set(net)] })); continue; }

  const userInput = await page.evaluate(() => {
    const els = [...document.querySelectorAll("#loginScreen input")];
    return els.map((e) => ({ type: e.type, id: e.id }));
  });
  await page.type('#loginScreen input[type="text"], #loginScreen input:not([type=password])', u, { delay: 10 });
  await page.type('#loginScreen input[type="password"]', p, { delay: 10 });
  await page.evaluate(() => [...document.querySelectorAll("#loginScreen button")].find((b) => b.textContent.match(/sign in/i))?.click());
  // wait up to 30s (cold Neon path can take ~15s) for success or failure
  let after = null;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    after = await page.evaluate(() => ({
      loginShowing: !document.getElementById("loginScreen")?.classList.contains("hidden"),
      badge: document.getElementById("modeBadge")?.textContent,
      err: document.getElementById("loginErr")?.textContent || "",
      session: sessionStorage.getItem("gp_session_v1"),
    }));
    if (!after.loginShowing || (after.err && after.err.indexOf("Checking") !== 0)) break;
  }
  console.log(JSON.stringify({ user: u, pass: p, hasCard, userInput, after, net: [...new Set(net)], errors: [...new Set(errors)] }));
}
await browser.close().catch(() => process.exit(0));

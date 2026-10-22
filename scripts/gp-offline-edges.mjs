import puppeteer from "puppeteer-core";
import { copyFileSync, mkdirSync } from "fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync("/tmp/gpfile", { recursive: true });
const A = "/tmp/gpfile/gpA.html", B = "/tmp/gpfile/other-name-B.html";
copyFileSync("/Users/nitpreetsingh/Desktop/SNM_feedback/public/gp-attendance.html", A);
copyFileSync("/Users/nitpreetsingh/Desktop/SNM_feedback/public/gp-attendance.html", B);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();

async function state(url, label) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  return await page.evaluate((l) => {
    const card = !!document.getElementById("loginScreen") && !document.getElementById("loginScreen").classList.contains("hidden");
    return {
      label: l,
      loginCard: card,
      marked5: !!(marks && mergedLog(5, selDate)),
      overlay: (localStorage.getItem("gp_marks_v1") || "").slice(0, 60),
      pending: localStorage.getItem("gp_pending_v1") || "",
      href: location.href,
    };
  }, label);
}

// open copy A, login offline (baked gp01), mark rid 5
await page.goto("file://" + A, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 2000));
await page.type("#inUser", "gp01", { delay: 10 });
await page.type("#inPin", "1111", { delay: 10 });
await page.evaluate(() => [...document.querySelectorAll("#loginScreen button")].find((b) => b.textContent.match(/sign in/i))?.click());
await new Promise((r) => setTimeout(r, 2500));
const loginState = await page.evaluate(() => ({
  loginShowing: !document.getElementById("loginScreen")?.classList.contains("hidden"),
  badge: document.getElementById("modeBadge")?.textContent,
}));
await page.evaluate(() => { document.getElementById("q").value = ""; });
// click the Mark present button for rid 5
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button.mark")].find((b) => b.dataset.rid === "5");
  btn?.click();
});
await new Promise((r) => setTimeout(r, 1500));
const stA = await page.evaluate(() => JSON.stringify({ marked5: !!mergedLog(5, selDate), marks: localStorage.getItem("gp_marks_v1"), pending: localStorage.getItem("gp_pending_v1") }));

// RELOAD copy A — the "refresh by mistake" case
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 2500));
const stReload = await state("file://" + A, "A after refresh");

// open copy B (re-download scenario) in the SAME browser
const stB = await state("file://" + B, "B (fresh re-download)");
// and A again after B
const stA2 = await state("file://" + A, "A after visiting B");

console.log(JSON.stringify({ loginState, stA, stReload, stB, stA2 }, null, 2));
await browser.close().catch(() => process.exit(0));

/**
 * Mobile (390px) captures for the gateway usage surface, plus a control
 * shot of a gateway page this branch does not touch, to show that the
 * sub-nav's behaviour at 390px belongs to the shared section layout
 * rather than to these changes.
 */
import { chromium } from "playwright";

const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:5590";
const SHOT_DIR = process.env.QA_SHOT_DIR ?? "/tmp/gateway-usage-qa";
const ORG_ID = "organization_0000USx9WDgmDaA9x5FrQykVHuuwa";
const VIEWER_PROJECT_SLUG = "rogerio-org-z7Rkq0";
const TARGET_VK = "vk_LtNASRpf1LqLTo5TvMAfnA";

async function main() {
  const { hash } = await import("bcrypt");
  const { prisma } = await import("../src/server/db");
  const user = await prisma.user.findUnique({
    where: { email: "dogfood@langwatch.local" },
  });
  if (!user) throw new Error("no dogfood user");
  const passwordHash = await hash("gateway-usage-qa-2026", 10);
  const account = await prisma.account.findFirst({
    where: { userId: user.id, provider: "credential" },
  });
  if (account) {
    await prisma.account.update({
      where: { id: account.id },
      data: { password: passwordHash },
    });
  }

  const { auth } = await import("../src/server/better-auth");
  const res = await auth.api.signInEmail({
    body: { email: "dogfood@langwatch.local", password: "gateway-usage-qa-2026" },
    asResponse: true,
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  const found = raw
    .map((c) => /^([^=]+)=([^;]+)/.exec(c))
    .find((m) => m && m[1]!.includes("session_token"));
  if (!found) throw new Error("no session cookie");
  const cookie = { name: found[1]!, value: decodeURIComponent(found[2]!) };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addCookies([
    { ...cookie, domain: "localhost", path: "/", httpOnly: true, secure: false },
  ]);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([org, slug]) => {
      localStorage.setItem("selectedOrganizationId", JSON.stringify(org));
      localStorage.setItem("selectedProjectSlug", JSON.stringify(slug));
    },
    [ORG_ID, VIEWER_PROJECT_SLUG],
  );

  const shots: Array<[string, string]> = [
    [`/settings/gateway/usage?vk=${TARGET_VK}&days=30`, "05-usage-mobile"],
    ["/settings/gateway/virtual-keys", "06-virtual-keys-mobile"],
    // Control: untouched by this branch.
    ["/settings/gateway/budgets", "07-budgets-mobile-control"],
  ];

  for (const [path, name] of shots) {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    // The section layout puts its sub-nav in the first column at this
    // width; scroll the content column into view so the shot shows the
    // page itself.
    const width = await page.evaluate(() => {
      let scrolled = "none";
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        if (el.scrollWidth > el.clientWidth + 40 && el.clientWidth > 200) {
          el.scrollLeft = el.scrollWidth;
          scrolled = `${el.tagName}.${el.className?.toString().slice(0, 40)} ${el.clientWidth}/${el.scrollWidth}`;
          break;
        }
      }
      return scrolled;
    });
    await page.waitForTimeout(800);
    console.log(`${name}: scrolled ${width}`);
    await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true });
    console.log(`   shot ${name}.png`);
  }

  await browser.close();
  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

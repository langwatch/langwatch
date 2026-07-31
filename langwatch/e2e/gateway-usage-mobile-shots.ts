/**
 * Mobile (390px) captures for the gateway usage surface, plus a control
 * shot of a gateway page this branch does not touch, to show that the
 * sub-nav's behaviour at 390px belongs to the shared section layout
 * rather than to these changes.
 *
 * Run it against a local stack, with the app's env loaded so the Prisma and
 * auth imports behind the sign-in helper resolve their configuration:
 *
 *   QA_PASSWORD=<throwaway> QA_BASE_URL=http://localhost:5590 \
 *     pnpm exec tsx --env-file=.env e2e/gateway-usage-mobile-shots.ts
 */
import { chromium } from "playwright";

import { localQaSessionCookie } from "./qa-local-session";

const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:5590";
const SHOT_DIR = process.env.QA_SHOT_DIR ?? "/tmp/gateway-usage-qa";
const ORG_ID = "organization_0000USx9WDgmDaA9x5FrQykVHuuwa";
const VIEWER_PROJECT_SLUG = "rogerio-org-z7Rkq0";
const TARGET_VK = "vk_LtNASRpf1LqLTo5TvMAfnA";

async function main() {
  const cookie = await localQaSessionCookie(BASE_URL);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addCookies([cookie]);
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
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>("*"),
      )) {
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

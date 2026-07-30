/**
 * PR screenshots for the per-seat (ATTRIBUTED_USER) budget display on the
 * AI Gateway budgets list: the cap each person carries, how many of them have
 * passed it, and the over-cap row sitting next to a healthy one so the red and
 * the neutral state can be compared in one look.
 *
 * Three shots: the per-seat rows on desktop, the stretch of table where the
 * per-seat rows meet the virtual-key rows, and the same page at 390px on a
 * tall viewport so it shows the list scrolled rather than the fold.
 *
 * Run it against a local stack, with the app's env loaded so the Prisma and
 * auth imports behind the sign-in helper resolve their configuration:
 *
 *   QA_PASSWORD=<throwaway> QA_BASE_URL=http://localhost:5560 \
 *     QA_SHOT_DIR=/tmp/budgets-per-seat \
 *     pnpm exec tsx --env-file=.env e2e/budgets-per-seat-shots.ts
 */
import * as fs from "fs";
import * as path from "path";

import {
  type BrowserContext,
  chromium,
  type Locator,
  type Page,
} from "playwright";

import { localQaSessionCookie } from "./qa-local-session";

const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:5560";
const SHOT_DIR = process.env.QA_SHOT_DIR ?? "/tmp/budgets-per-seat";
const ORG_ID = process.env.QA_ORG_ID ?? "organization_uZxM7g6VQwmnp9I6VkCCl";
const PROJECT_SLUG = process.env.QA_PROJECT_SLUG ?? "agent-billing-demo-fmqegm";

/** A per-seat budget with someone over the cap, and one with nobody over it. */
const OVER_CAP_ROW = "Manouk Trucks per-seat allowance";
const HEALTHY_ROW = "Rogerio Trucks per-seat allowance";

/**
 * Tall enough that the whole stretch of table a shot needs is laid out inside
 * the viewport, so every capture is a straight crop of what is on screen
 * rather than a stitched full-page image, and short enough that the list can
 * still scroll a chosen row up to the header.
 */
const DESKTOP_WIDTH = 1440;
const DESKTOP_HEIGHT = Number(process.env.QA_DESKTOP_HEIGHT ?? 1400);
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = Number(process.env.QA_MOBILE_HEIGHT ?? 3000);
const NARROW_WIDTH = Number(process.env.QA_NARROW_WIDTH ?? 1024);
const NARROW_HEIGHT = Number(process.env.QA_NARROW_HEIGHT ?? 2200);

const PER_SEAT_CELL = '[data-testid="budget-attributed-user-spend"]';

type Box = { x: number; y: number; width: number; height: number };
type RowInfo = {
  name: string;
  perSeat: boolean;
  top: number;
  bottom: number;
  left: number;
  right: number;
};

function row(page: Page, name: string): Locator {
  // A regex keeps the match case-sensitive: the demo org also carries
  // lower-cased near-duplicates of these budgets from earlier runs.
  return page
    .locator("tbody tr")
    .filter({ hasText: new RegExp(name) })
    .first();
}

/**
 * The assistant persists its own open/closed state, so closing it in storage
 * before the first paint means the page never reserves room for the panel.
 * The floating launcher goes afterwards, so nothing overlaps the table.
 */
async function hideAssistant(page: Page) {
  const minimise = page.getByRole("button", { name: "Minimise Langy" });
  if ((await minimise.count()) > 0) {
    await minimise
      .first()
      .click({ timeout: 5_000 })
      .catch(() => {});
  }
  const hidden = await page.evaluate(() => {
    const selectors = [
      '[aria-label="Langy assistant"]',
      '[aria-label="Open Langy assistant"]',
      '[aria-label="Langy conversation"]',
    ];
    let count = 0;
    for (const selector of selectors) {
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>(selector),
      )) {
        el.style.display = "none";
        count += 1;
      }
    }
    return count;
  });
  console.log(`assistant elements hidden: ${hidden}`);
}

async function openBudgets(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([org, slug]) => {
      localStorage.setItem("selectedOrganizationId", JSON.stringify(org));
      localStorage.setItem("selectedProjectSlug", JSON.stringify(slug));
      localStorage.setItem(
        "langy:store",
        JSON.stringify({ state: { isOpen: false }, version: 0 }),
      );
    },
    [ORG_ID, PROJECT_SLUG],
  );
  await page.goto(`${BASE_URL}/settings/gateway/budgets`, {
    waitUntil: "domcontentloaded",
  });
  await row(page, OVER_CAP_ROW).waitFor({ timeout: 90_000 });
  // Spend arrives after the list, so the seat counts settle last; waiting on
  // that text means no shot catches a half-filled row.
  await page
    .getByText(/people over cap/)
    .first()
    .waitFor({ timeout: 90_000 });
  await hideAssistant(page);
  await page.waitForTimeout(2_000);
  return page;
}

/**
 * The page scrolls inside the app shell rather than on the window, and at
 * phone widths the section layout adds a second, horizontal scroller around
 * its sub-nav. This moves the scroller that actually owns each axis: `inner`
 * for the one nearest the table, `outer` for the column that holds the
 * sub-nav next to the content.
 */
async function scrollTable(
  page: Page,
  args: {
    top?: number;
    topBy?: number;
    left?: number;
    leftBy?: number;
    outerLeft?: number;
  },
) {
  await page.evaluate((moves) => {
    const start = document.querySelector("tbody tr");
    const jobs: Array<{
      axis: string;
      relative: boolean;
      value: number;
      depth: number;
    }> = [];
    if (typeof moves.top === "number") {
      jobs.push({ axis: "y", relative: false, value: moves.top, depth: 1 });
    }
    if (typeof moves.topBy === "number") {
      jobs.push({ axis: "y", relative: true, value: moves.topBy, depth: 1 });
    }
    if (typeof moves.left === "number") {
      jobs.push({ axis: "x", relative: false, value: moves.left, depth: 1 });
    }
    if (typeof moves.leftBy === "number") {
      jobs.push({ axis: "x", relative: true, value: moves.leftBy, depth: 1 });
    }
    if (typeof moves.outerLeft === "number") {
      jobs.push({
        axis: "x",
        relative: false,
        value: moves.outerLeft,
        depth: 2,
      });
    }

    for (const job of jobs) {
      let el: HTMLElement | null = start?.parentElement ?? null;
      let target: HTMLElement | null =
        (document.scrollingElement as HTMLElement | null) ?? null;
      let seen = 0;
      while (el) {
        const style = getComputedStyle(el);
        const overflow = job.axis === "y" ? style.overflowY : style.overflowX;
        const room =
          job.axis === "y"
            ? el.scrollHeight - el.clientHeight
            : el.scrollWidth - el.clientWidth;
        if (/(auto|scroll)/.test(overflow) && room > 4) {
          seen += 1;
          if (seen === job.depth) {
            target = el;
            break;
          }
        }
        el = el.parentElement;
      }
      if (!target) continue;
      if (job.axis === "y") {
        target.scrollTop = job.relative
          ? target.scrollTop + job.value
          : job.value;
      } else {
        target.scrollLeft = job.relative
          ? target.scrollLeft + job.value
          : job.value;
      }
    }
  }, args);
  await page.waitForTimeout(500);
}

/** Every body row, in render order, with where it currently sits on screen. */
async function readRows(page: Page): Promise<RowInfo[]> {
  return page.evaluate((cellSelector) => {
    return Array.from(document.querySelectorAll<HTMLElement>("tbody tr")).map(
      (tr) => {
        const rect = tr.getBoundingClientRect();
        return {
          name: (tr.querySelector("td")?.textContent ?? "").trim(),
          perSeat: !!tr.querySelector(cellSelector),
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        };
      },
    );
  }, PER_SEAT_CELL);
}

async function shoot(page: Page, name: string, clip?: Box) {
  const file = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, clip });
  const { size } = fs.statSync(file);
  console.log(
    `captured ${name}.png (${Math.round(size / 1024)}kB)` +
      (clip
        ? ` clip ${Math.round(clip.width)}x${Math.round(clip.height)} at ${Math.round(clip.x)},${Math.round(clip.y)}`
        : ""),
  );
}

/**
 * Where the page's pinned chrome ends. The list scrolls underneath it, so a
 * shot taken from the top of the viewport has to start its first row here.
 */
async function stickyHeaderBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    let bottom = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const style = getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      const rect = el.getBoundingClientRect();
      // Two bars stack up there: the app's own and the page's title row, the
      // lower of which does not start at the very top of the viewport.
      const pinnedToTop =
        rect.top <= 160 && rect.height > 0 && rect.bottom < 300;
      if (pinnedToTop && rect.width > 400 && rect.bottom > bottom) {
        bottom = rect.bottom;
      }
    }
    return Math.round(bottom);
  });
}

function indexOfRow(rows: RowInfo[], name: string): number {
  const at = rows.findIndex((r) => r.name.includes(name));
  if (at < 0) throw new Error(`no row named ${name} in the list`);
  return at;
}

async function desktopShots(
  cookie: Awaited<ReturnType<typeof localQaSessionCookie>>,
) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT },
    deviceScaleFactor: 2,
  });
  await context.addCookies([cookie]);
  const page = await openBudgets(context);
  await scrollTable(page, { top: 0, left: 0 });

  let rows = await readRows(page);
  const overCap = indexOfRow(rows, OVER_CAP_ROW);
  const healthy = indexOfRow(rows, HEALTHY_ROW);
  const firstPerSeat = rows.findIndex((r) => r.perSeat);
  console.log(
    `${rows.length} rows, ${rows.filter((r) => r.perSeat).length} per-seat; ` +
      `over-cap #${overCap}, healthy #${healthy}, first per-seat row #${firstPerSeat}`,
  );

  // Shot 1: the two rows that carry the point, with the virtual-key row above
  // them and two more per-seat rows below for context. Bringing the first of
  // them near the top of the tall viewport keeps the last one whole, so
  // neither edge of the crop cuts a row in half.
  const from = Math.max(0, Math.min(overCap, healthy) - 1);
  const to = Math.min(rows.length - 1, Math.max(overCap, healthy) + 2);
  await scrollTable(page, { topBy: rows[from]!.top - 200 });
  rows = await readRows(page);
  const first = rows[from]!;
  const last = rows[to]!;
  if (last.bottom > DESKTOP_HEIGHT || first.top < 0) {
    throw new Error("the rows for shot 1 do not fit; raise QA_DESKTOP_HEIGHT");
  }
  await shoot(page, "budget-per-seat-rows", {
    x: first.left,
    y: first.top - 1,
    width: first.right - first.left,
    height: last.bottom - first.top + 2,
  });

  // Shot 2: the boundary between the two treatments, framed under the app
  // header so the shot also carries the organization it was taken in. Rows
  // scroll beneath that header, so the first one lands exactly at its lower
  // edge and no half row shows above it.
  const window0 = Math.max(0, firstPerSeat - 4);
  const window1 = Math.min(rows.length - 1, firstPerSeat + 4);
  const headerBottom = await stickyHeaderBottom(page);
  await scrollTable(page, { topBy: rows[window0]!.top - headerBottom });
  rows = await readRows(page);
  const bottom = rows[window1]!.bottom;
  if (bottom > DESKTOP_HEIGHT) {
    throw new Error("the rows for shot 2 do not fit; raise QA_DESKTOP_HEIGHT");
  }
  await shoot(page, "budget-per-seat-with-key-scopes", {
    x: 0,
    y: 0,
    width: DESKTOP_WIDTH,
    height: Math.round(bottom) + 1,
  });

  await browser.close();
}

/** How much of the table the content column can actually show at this width. */
async function reportContentWidth(page: Page) {
  const fit = await page.evaluate(() => {
    const table = document.querySelector("table");
    const card = table?.closest<HTMLElement>(".chakra-card__root") ?? null;
    return {
      table: table?.scrollWidth ?? 0,
      card: card?.clientWidth ?? 0,
    };
  });
  console.log(
    `content column ${fit.card}px wide for a ${fit.table}px table` +
      (fit.card < fit.table
        ? ", so the table is clipped: the section layout's fixed 220px sub-nav leaves the card too narrow"
        : ""),
  );
  return fit;
}

/**
 * A width where the table still fits beside the section sub-nav, which is the
 * narrowest view that can show the per-seat cell at all.
 */
async function narrowShot(
  cookie: Awaited<ReturnType<typeof localQaSessionCookie>>,
) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: NARROW_WIDTH, height: NARROW_HEIGHT },
    deviceScaleFactor: 2,
  });
  await context.addCookies([cookie]);
  const page = await openBudgets(context);
  await scrollTable(page, { top: 0, left: 0 });
  await reportContentWidth(page);

  let rows = await readRows(page);
  const overCap = indexOfRow(rows, OVER_CAP_ROW);
  const headerBottom = await stickyHeaderBottom(page);
  await scrollTable(page, {
    topBy: rows[Math.max(0, overCap - 2)]!.top - headerBottom,
  });
  rows = await readRows(page);
  const last = rows[Math.min(rows.length - 1, overCap + 2)]!;
  await shoot(page, "budget-per-seat-narrow-1024", {
    x: 0,
    y: 0,
    width: NARROW_WIDTH,
    height: Math.min(NARROW_HEIGHT, Math.round(last.bottom) + 1),
  });
  await browser.close();
}

/**
 * The phone view. The gateway section layout keeps its 220px sub-nav at every
 * width, so this shot shows the page as a phone really renders it rather than
 * a table scrolled into a frame that does not exist.
 */
async function mobileShot(
  cookie: Awaited<ReturnType<typeof localQaSessionCookie>>,
) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: MOBILE_WIDTH, height: MOBILE_HEIGHT },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addCookies([cookie]);
  const page = await openBudgets(context);
  await scrollTable(page, { top: 0, left: 0 });
  await reportContentWidth(page);
  await shoot(page, "budget-per-seat-mobile");
  await browser.close();
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const cookie = await localQaSessionCookie(BASE_URL);
  await desktopShots(cookie);
  await narrowShot(cookie);
  await mobileShot(cookie);
  console.log(`shots in ${SHOT_DIR}`);
  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { withPreviewBrowser } from "./browser-fixture.mjs";

const { values } = parseArgs({
  options: { "out-dir": { type: "string" }, screenshots: { type: "string" } },
});
const outDir = path.resolve(values["out-dir"] ?? "dist");
const screenshots = path.resolve(values.screenshots ?? "layout-shots");
await mkdir(screenshots, { recursive: true });

async function assertDocumentFlow({ page, desktop }) {
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector(".docs-layout");
    const footer = document.querySelector(".docs-site-footer");
    const rail = document.querySelector(".docs-left-rail");
    const header = document.querySelector("header");
    const bounds = (node) => node.getBoundingClientRect();
    const scrollBoxes = [...panel.querySelectorAll("*")]
      .filter((node) => {
        if (node === rail) return false;
        const style = getComputedStyle(node);
        return (
          /auto|scroll/.test(style.overflowY) &&
          node.clientHeight > 0 &&
          node.scrollHeight > node.clientHeight + 2
        );
      })
      .map((node) => node.className);
    return {
      footerOutside: !panel.contains(footer),
      footerTop: bounds(footer).top,
      panelBottom: bounds(panel).bottom,
      footerWidth: bounds(footer).width,
      railBottom: bounds(rail).bottom,
      railHeight: bounds(rail).height,
      headerHeight: bounds(header).height,
      viewport: innerHeight,
      railPosition: getComputedStyle(rail).position,
      scrollBoxes,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.equal(geometry.footerOutside, true);
  assert.ok(geometry.footerTop >= geometry.panelBottom);
  assert.equal(geometry.footerWidth, page.viewportSize().width);
  assert.deepEqual(geometry.scrollBoxes, []);
  assert.equal(geometry.overflow, false);
  if (desktop) {
    assert.ok(geometry.railBottom <= geometry.panelBottom + 1);
    assert.equal(geometry.railPosition, "sticky");
    assert.ok(geometry.railHeight <= geometry.viewport - geometry.headerHeight + 1);
  }
}
async function capture({ page, name, width, mode }) {
  await page.screenshot({ path: path.join(screenshots, `${name}-${width}-${mode}.png`) });
}
async function reviewPage({ page, base, slug, width, mode }) {
  await page.goto(base + slug);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Boolean(document.querySelector('[data-island="toc"]')));
  assert.equal(await page.evaluate(() => scrollY), 0);
  const desktop = width >= 1024;
  if (desktop) {
    await page.waitForFunction(() => {
      const active = document.querySelector('.docs-left-rail [aria-current="page"]');
      return !active || active.getBoundingClientRect().height > 0;
    });
    assert.equal(
      await page
        .locator('.docs-left-rail [aria-current="page"]')
        .evaluate((node) => getComputedStyle(node).boxShadow),
      "none",
    );
  }
  await page.evaluate(() => scrollTo(0, 0));
  const header = await page.locator("header").boundingBox();
  const panel = await page.locator(".docs-layout").boundingBox();
  assert.ok(panel.y >= header.y + header.height - 1);
  assert.deepEqual(
    await page.locator(".docs-layout").evaluate((node) => {
      const style = getComputedStyle(node);
      return { radius: style.borderTopLeftRadius, shadow: style.boxShadow };
    }),
    { radius: "0px", shadow: "none" },
  );
  const name = slug.replaceAll("/", "_");
  await capture({ page, name: `${name}-top`, width, mode });
  await assertDocumentFlow({ page, desktop });
  await page.evaluate(() => scrollTo(0, 700));
  await assertDocumentFlow({ page, desktop });
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await assertDocumentFlow({ page, desktop });
  await capture({ page, name: `${name}-bottom`, width, mode });
}

/** @scenario "Scroll a long API section naturally" */
await it("uses one document scroll and keeps the footer below both article and navigation", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const width of [1280, 1440, 1670, 390]) {
        for (const mode of ["light", "dark"]) {
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
            colorScheme: mode,
            reducedMotion: "reduce",
          });
          try {
            const page = await context.newPage();
            for (const slug of ["api-reference/introduction", "integration/quick-start", "support"])
              await reviewPage({ page, base, slug, width, mode });
          } finally {
            await context.close();
          }
        }
      }
      const context = await browser.newContext({
        viewport: { width: 1440, height: 800 },
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        await page.goto(base + "prompt-management/overview");
        await page.evaluate(() => scrollTo(0, 600));
        const link = page.locator(
          '.docs-left-rail a[href$="/prompt-management/prompt-playground"]',
        );
        await link.click();
        await page.waitForURL(/prompt-playground$/);
        // The new page opens at its top; banners already scrolled away stay away.
        await page.waitForFunction(() => {
          const header = document.querySelector("header").getBoundingClientRect();
          const title = document.querySelector("main h1")?.getBoundingClientRect();
          return header.top >= 0 && title && title.top >= header.bottom && title.top < 300;
        });
        // A full rail ends at the viewport's edge, never past it, so its last link is
        // never clipped.
        const railBox = await page.locator(".docs-left-rail").boundingBox();
        assert.ok(railBox && railBox.y + railBox.height <= 800, JSON.stringify(railBox));
        const box = await link.boundingBox();
        if (!(box && box.y >= 0 && box.y + box.height <= 800)) {
          await capture({ page, name: "rail-link-after-swap", width: 1440, mode: "light" });
          const rail = await page.evaluate(() => {
            const root = document.querySelector(".docs-left-rail");
            return { scrollTop: root?.scrollTop, height: root?.clientHeight, pageY: scrollY };
          });
          assert.fail(`the clicked rail link left the viewport: ${JSON.stringify({ box, rail })}`);
        }
      } finally {
        await context.close();
      }
    },
  });
});

/* In the page: every control, whether it is drawn in view, exempt as running text or the
   pointer-only progress ticks, or scrolled under the sticky header. */
function listControls() {
  const header = document.querySelector("header").getBoundingClientRect();
  return [...document.querySelectorAll("a[href], button, summary, [role=tab]")].map(
    (node, index) => {
      node.dataset.touch = String(index);
      const box = node.getBoundingClientRect();
      const y = box.top + box.height / 2;
      const closed = node.closest("details:not([open])") && !node.matches("details > summary");
      return {
        index,
        label: (node.getAttribute("aria-label") || node.textContent).trim().slice(0, 40),
        x: box.left + box.width / 2,
        y,
        drawn: box.width > 0 && box.bottom > 0 && box.top < innerHeight && !closed,
        shown: node.checkVisibility({ visibilityProperty: true }),
        exempt: node.matches(
          ".docs-skip-link, .docs-progress-track a, .docs-prose :is(p, li, td) a",
        ),
        underHeader: !node.closest("header") && y > header.top && y - 22 < header.bottom,
      };
    },
  );
}

/* In the page: what a tap at each point reaches: the control itself, a neighbour, nothing, or no
   element because the point is off screen. */
function tapsAt(points) {
  return points.map(({ index, x, y }) => {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return "off";
    const control = hit.closest("[data-touch]");
    if (control?.dataset.touch === String(index)) return "self";
    return control ? "neighbour" : "none";
  });
}

/* In the page: visible text under 11px, the article's own text size and overlapping header
   controls. */
function readability() {
  const tiny = [...document.querySelectorAll("body *")]
    .filter((node) =>
      [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim()),
    )
    .filter((node) => node.checkVisibility() && !node.closest(".docs-sr-only, [aria-hidden=true]"))
    .map((node) => `${node.tagName.toLowerCase()} ${getComputedStyle(node).fontSize}`)
    .filter((entry) => Number.parseFloat(entry.split(" ")[1]) < 11);
  const prose = [...document.querySelectorAll(".docs-prose > p")].find(
    (node) => !node.closest(".docs-skill-card, details, aside"),
  );
  const boxes = [...document.querySelectorAll("header :is(a[href], button)")]
    .filter((node) => node.checkVisibility())
    .map((node) => node.getBoundingClientRect())
    .filter((box) => box.width > 0);
  const apart = (a, b) =>
    a.right - 1 <= b.left ||
    b.right - 1 <= a.left ||
    a.bottom - 1 <= b.top ||
    b.bottom - 1 <= a.top;
  return {
    sideways: document.documentElement.scrollWidth - innerWidth,
    tiny: [...new Set(tiny)],
    prose: prose ? Number.parseFloat(getComputedStyle(prose).fontSize) : 16,
    overlaps: boxes.flatMap((a, index) => boxes.slice(index + 1).filter((b) => !apart(a, b)))
      .length,
  };
}

/* A tap 21px out from a control's centre must reach it or a neighbouring control; a control whose
   centre is covered, or that is not in view, is skipped. */
const OFFSETS = [
  [0, 0],
  [-21, 0],
  [21, 0],
  [0, -21],
  [0, 21],
];
async function smallTargets({ page }) {
  const controls = (await page.evaluate(listControls)).filter(
    (control) => control.drawn && control.shown && !control.exempt && !control.underHeader,
  );
  const points = controls.flatMap(({ index, x, y }) =>
    OFFSETS.map(([dx, dy]) => ({ index, x: x + dx, y: y + dy })),
  );
  const taps = await page.evaluate(tapsAt, points);
  return controls
    .filter((_, n) => {
      const [centre, ...edges] = taps.slice(n * OFFSETS.length, (n + 1) * OFFSETS.length);
      return centre === "self" && edges.includes("none");
    })
    .map((control) => control.label);
}

async function assertTouchFriendly({ page, where }) {
  const small = await smallTargets({ page });
  assert.deepEqual(small, [], `${where}: targets under 44px: ${small.join(", ")}`);
  const report = await page.evaluate(readability);
  assert.equal(report.sideways, 0, `${where} scrolls sideways`);
  assert.deepEqual(report.tiny, [], `${where}: text under 11px: ${report.tiny.join(", ")}`);
  assert.ok(report.prose >= 16, `${where}: article text ${report.prose}px`);
  assert.equal(report.overlaps, 0, `${where}: header controls overlap`);
}

/** @scenario "Read and tap comfortably on a phone or a tablet" */
await it("fits phones and tablets, with 44 pixel touch targets and readable text", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const width of [360, 390, 768]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          isMobile: true,
          hasTouch: true,
          reducedMotion: "reduce",
        });
        try {
          const page = await context.newPage();
          for (const slug of [
            "introduction",
            "integration/quick-start",
            "api-reference/traces/get-trace",
            "changelog",
            "skills/directory",
            "features/webhooks",
          ]) {
            await page.goto(base + slug);
            await page.evaluate(() => document.fonts.ready);
            for (const scroll of [0, 900]) {
              await page.evaluate((top) => scrollTo(0, top), scroll);
              await assertTouchFriendly({
                page,
                where: `${slug} at ${width}px, scrolled ${scroll}`,
              });
            }
          }
        } finally {
          await context.close();
        }
      }
    },
  });
});

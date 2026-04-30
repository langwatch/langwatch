# PRD-024 · Empty-state onboarding tour

## Goal

A first-time user (project has zero real traces) lands on `/traces`,
moves through a guided journey that teaches density, the aurora
arrival signal, the trace drawer, and facets, and is offered the
Integrate CTA at the end. They can skip at any point.

The journey runs entirely on local fixtures — no token, no OTel
ingestion, no DB round-trip. The moment a real trace lands the
journey stops being shown.

## Stages (canonical order)

| # | Stage | Trigger | Auto / manual | Heading layout |
|---|---|---|---|---|
| 1 | `welcome` | mount | typewriter | centre |
| 2 | `densityIntro` | from welcome | manual (card click + confirm) | centre |
| 3 | `arrivalPrep` | from densityIntro | typewriter + auto-advance | centre |
| 4 | `auroraArrival` | from arrivalPrep | auto-advance after aurora | centre, hero dim |
| 5 | `postArrival` | from auroraArrival | row click or 8s auto-open | centre |
| 6 | `tourGate` | drawer opens | user picks tour or skip | left |
| 7 | `drawerOverview` | from tourGate "Show me around" | manual Continue | left |
| 8 | `serviceSegue` | from drawerOverview | manual Continue | left |
| 9 | `facetsReveal` | from serviceSegue, OR direct from tourGate "I'll explore myself" | manual Continue | bottomCentre |
| 10 | `outro` | from facetsReveal | terminal | centre |

## Out of scope (this PR)

- Per-region drawer glow during `drawerOverview` (header, conversation, spans, evals individually).
- Service-chip click in `serviceSegue` actually applying a filter; currently the Continue CTA advances.
- Sidebar slide-in animation during `facetsReveal` (currently snaps in).

## Acceptance criteria

Each line below must hold true. Test them as a checklist.

### Layout / visibility

- [ ] AC-L1 — Hero copy is fully visible at every stage on a 1366×768 viewport.
- [ ] AC-L2 — Hero copy is **never** occluded by the trace drawer during stages 6–8 (`tourGate`, `drawerOverview`, `serviceSegue`).
- [ ] AC-L3 — Hero composition fits inside the gradient band (no overflow above or below) at every stage.
- [ ] AC-L4 — `FilterAside` is hidden during stages 1–8 and visible during stages 9–10.
- [ ] AC-L5 — `FilterAside` shows an animated blue glow during stage 9 only; glow is gone by stage 10.
- [ ] AC-L6 — Trace table is fully populated with sample fixtures at every stage (never blank).

### Functional

- [ ] AC-F1 — Welcome stage types out heading + subhead and auto-advances to `densityIntro`.
- [ ] AC-F2 — Density cards are clickable. First click sets density + flips chip to `Continue →`. Second click on the same card advances to `arrivalPrep`.
- [ ] AC-F3 — Density confirmation persists to `localStorage` under `langwatch:traces-v2:onboarding:density-confirmed:v1`.
- [ ] AC-F4 — On a second visit (or after `Watch the tour again`), `densityIntro` is auto-skipped.
- [ ] AC-F5 — Aurora ribbon mounts at top of viewport during `auroraArrival` and unmounts on stage advance.
- [ ] AC-F6 — `ARRIVAL_PREVIEW_TRACES` (2 fixtures) appear at the top of the table during `auroraArrival` onward.
- [ ] AC-F7 — Rich arrival row glimmers blue in **both** light and dark themes during `postArrival`.
- [ ] AC-F8 — Rich arrival row is clickable during `postArrival` (cursor: pointer, no `inert`, no `pointer-events: none`).
- [ ] AC-F9 — If the user does not click for 8 seconds, the drawer auto-opens with the rich arrival.
- [ ] AC-F10 — Drawer always opens with `vizTab: "waterfall"` for any preview trace.
- [ ] AC-F11 — Drawer tabs hydrate with seeded data (header, spans, conversation 3 turns, evals).
- [ ] AC-F12 — `tourGate` "Show me around" advances to `drawerOverview`.
- [ ] AC-F13 — `tourGate` "I'll explore myself" jumps directly to `facetsReveal` (skipping drawer tour).
- [ ] AC-F14 — `Watch the tour again` in `outro` resets stage to `welcome`. `densityIntro` auto-skips on the re-run.
- [ ] AC-F15 — `Skip for now` (`K`) at any stage dismisses the empty state for the current project.
- [ ] AC-F16 — The toolbar's "SDK connection pending" button re-opens the empty state after a skip.

### Animation / motion

- [ ] AC-A1 — Hero opacity drops to ~45% during `auroraArrival` and returns to 100% on advance.
- [ ] AC-A2 — Hero re-anchors smoothly (≥300ms ease) when `heroLayout` changes between stages.
- [ ] AC-A3 — Aurora ribbon's curtains drift continuously while the strip is mounted.
- [ ] AC-A4 — Rich arrival row glimmer pulses uniformly across all cells (no per-cell sweep).
- [ ] AC-A5 — Sidebar glow during `facetsReveal` pulses every ~2.4s, paused on hover (if hover wired).

### Keyboard

- [ ] AC-K1 — `K` skips at every stage.
- [ ] AC-K2 — `I` opens the integrate drawer at every stage where it's visible.
- [ ] AC-K3 — `Backspace` / `←` rolls the journey back one stage when history exists.
- [ ] AC-K4 — `D` toggles density (existing toolbar shortcut, not gated by stage).

### Theming

- [ ] AC-T1 — All glow / shadow effects render visibly in both light and dark themes.
- [ ] AC-T2 — No hex literals in component code; all colours go through Chakra semantic tokens or the `_dark` modifier.

## Test scenarios (smoke)

These map 1-to-1 against the AC list. Each scenario takes 30–60 seconds.

### S1 — Happy path (full tour)

1. Fresh project, no real traces, no localStorage.
2. Open `/traces`.
3. Wait through welcome typewriter. → AC-F1.
4. Click `Compact` card. Click again. → AC-F2.
5. Reload the page. Density step is auto-skipped. → AC-F3, AC-F4.
6. Continue to arrivalPrep. Wait for aurora. → AC-F5, AC-F6, AC-A1, AC-A3.
7. Wait through postArrival. Verify row glimmers in both themes. → AC-F7, AC-A4, AC-T1.
8. Click the rich row. Drawer opens on waterfall with seeded data. → AC-F8, AC-F10, AC-F11.
9. tourGate appears. Hero on left, not under drawer. → AC-L2, AC-F12.
10. Click "Show me around". → drawerOverview → serviceSegue → facetsReveal.
11. Sidebar visible with blue glow. → AC-L4, AC-L5, AC-A5.
12. Click "Got it". → outro. Sidebar visible without glow. → AC-L4, AC-L5.
13. Click "↻ Watch the tour again". Density step auto-skips. → AC-F14.

### S2 — Skip-the-tour path

1. Fresh project, density already confirmed in localStorage.
2. Open `/traces`. Density auto-skips. Reach postArrival.
3. Click row. Drawer opens. tourGate appears.
4. Click "I'll explore myself". → AC-F13. User lands in `facetsReveal`. Sidebar visible with glow.

### S3 — Auto-open path

1. Fresh project. Reach postArrival.
2. Don't click anything. Wait 8 seconds.
3. Drawer auto-opens with rich arrival. → AC-F9.

### S4 — Hard skip

1. At any stage, press `K`. Empty state dismisses for project. → AC-F15.
2. Click toolbar's "SDK connection pending". Empty state re-renders, stage resets to welcome. → AC-F16.

### S5 — Theming

1. Switch theme to dark via the system. Run S1 again.
2. Glow effects and aurora must remain readable. → AC-T1.

## Manual test checklist (one-page)

Print this and tick off:

```
[ ] Welcome types out, advances on its own
[ ] Density cards visible; click compact, click again, advances
[ ] Re-running tour: density step auto-skipped
[ ] Aurora visibly fires, rows land at top
[ ] Rich row glimmers blue (BOTH light + dark themes)
[ ] Rich row is clickable (cursor pointer, click opens drawer)
[ ] Drawer opens on WATERFALL view
[ ] Drawer header, spans, conversation, evals all populated
[ ] Hero never disappears under the drawer
[ ] tourGate offers "Show me around" / "I'll explore myself"
[ ] "Show me around" steps through 4 stages cleanly
[ ] "I'll explore myself" jumps straight to facets
[ ] Sidebar visible + glowing during facetsReveal
[ ] Sidebar visible (no glow) during outro
[ ] "Watch the tour again" works; density auto-skips
[ ] K skips at any stage
[ ] Backspace goes back one stage
```

## Automated smoke (skeleton)

Place at `src/features/traces-v2/components/EmptyState/__tests__/journey.browser.test.tsx`.
This is a skeleton; flesh out selectors against the actual rendered DOM.

```tsx
import { test, expect } from "@playwright/test";

const URL = "/[project-slug]/traces"; // use a fresh project

test.describe("empty-state onboarding tour", () => {
  test.beforeEach(async ({ page }) => {
    // Clear the density-confirmed flag and project-dismissed flag
    await page.addInitScript(() => {
      localStorage.removeItem("langwatch:traces-v2:onboarding:density-confirmed:v1");
      const ui = JSON.parse(localStorage.getItem("langwatch:traces-v2:ui") ?? "{}");
      ui.setupDismissedByProject = {};
      localStorage.setItem("langwatch:traces-v2:ui", JSON.stringify(ui));
    });
    await page.goto(URL);
  });

  test("S1 — full tour completes without layout breaks", async ({ page }) => {
    // Welcome
    await expect(page.getByText(/Meet your trace explorer/i)).toBeVisible();
    // Density
    await expect(page.getByText(/let's match your vibe/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /Compact/i }).click();
    await page.getByRole("button", { name: /Compact/i }).click(); // second click confirms
    // Aurora arrival
    await expect(page.getByText(/Watch out for the aurora/i)).toBeVisible({ timeout: 8000 });
    // Post-arrival glimmer + click
    await expect(page.getByText(/Check out this Taylor Swift hot take/i)).toBeVisible({ timeout: 12000 });
    const richRow = page.locator(`[data-trace-id*="lw-preview-arrival-01"]`);
    await expect(richRow).toBeVisible();
    await richRow.click();
    // Drawer opens on waterfall
    await expect(page.locator(`[role=dialog]`).getByText(/waterfall/i)).toBeVisible();
    // Tour gate
    await page.getByRole("button", { name: /Show me around/i }).click();
    // Through to outro
    await page.getByRole("button", { name: /Continue/i }).click(); // drawerOverview → serviceSegue
    await page.getByRole("button", { name: /Show me/i }).click();   // serviceSegue → facetsReveal
    await page.getByRole("button", { name: /Got it/i }).click();    // facetsReveal → outro
    // Outro affordances
    await expect(page.getByText(/That's the lot/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Integrate my code/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Watch the tour again/i })).toBeVisible();
  });

  test("S2 — skip-the-tour drops user in facets", async ({ page }) => {
    // Pre-confirm density so we move faster
    await page.evaluate(() => {
      localStorage.setItem("langwatch:traces-v2:onboarding:density-confirmed:v1", "true");
    });
    await page.reload();
    // Wait through welcome + arrivalPrep + auroraArrival
    await expect(page.getByText(/Check out this Taylor Swift hot take/i)).toBeVisible({ timeout: 18000 });
    await page.locator(`[data-trace-id*="lw-preview-arrival-01"]`).click();
    await page.getByRole("button", { name: /I'll explore myself/i }).click();
    await expect(page.getByText(/These are facets/i)).toBeVisible();
  });

  test("S3 — auto-open after 8s", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem("langwatch:traces-v2:onboarding:density-confirmed:v1", "true");
    });
    await page.reload();
    await expect(page.getByText(/Check out this Taylor Swift hot take/i)).toBeVisible({ timeout: 18000 });
    // Wait 9s without clicking — drawer should open on its own
    await page.waitForTimeout(9000);
    await expect(page.getByRole("button", { name: /Show me around/i })).toBeVisible();
  });

  test("hero never sits behind the drawer", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem("langwatch:traces-v2:onboarding:density-confirmed:v1", "true");
    });
    await page.reload();
    await expect(page.getByText(/Check out this Taylor Swift hot take/i)).toBeVisible({ timeout: 18000 });
    await page.locator(`[data-trace-id*="lw-preview-arrival-01"]`).click();
    // Hero should be visible while drawer is open
    const hero = page.getByText(/Want a quick tour/i);
    await expect(hero).toBeVisible();
    const heroBox = await hero.boundingBox();
    const drawerBox = await page.locator(`[role=dialog]`).boundingBox();
    if (heroBox && drawerBox) {
      // Hero's right edge should be left of the drawer's left edge.
      expect(heroBox.x + heroBox.width).toBeLessThanOrEqual(drawerBox.x);
    }
  });
});
```

## Bug catalogue (the things this test exists to catch)

| # | Symptom | AC it would fail |
|---|---|---|
| B1 | Hero text covered by drawer | AC-L2 |
| B2 | Hero clipped above/below the gradient band | AC-L3 |
| B3 | Drawer opens on a non-waterfall tab | AC-F10 |
| B4 | Drawer tabs blank (header only) | AC-F11 |
| B5 | Density picker doesn't persist | AC-F3, AC-F4 |
| B6 | Aurora plays but no rows arrive | AC-F6 |
| B7 | Rich row not clickable (`pointer-events: none` leaked) | AC-F8 |
| B8 | Glimmer invisible on dark theme | AC-F7, AC-T1 |
| B9 | Sidebar still hidden in `facetsReveal` | AC-L4 |
| B10 | "Watch the tour again" doesn't reset stage | AC-F14 |
| B11 | Backspace doesn't go back | AC-K3 |
| B12 | `arrivalPrep` heading shows on a single line (line break broken) | AC-L1 (visual) |

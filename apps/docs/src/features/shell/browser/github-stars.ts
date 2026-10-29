import { formatStars, githubLabel } from "../model/github-stars.ts";

const REPOSITORY_URL = "https://api.github.com/repos/langwatch/langwatch";
const STORAGE_KEY = "lw-docs:github-stars";
/* GitHub allows 60 anonymous reads an hour per address; one an hour per reader stays inside it. */
export const STARS_FRESH_MS = 60 * 60 * 1000;

type StarsWindow = Pick<Window, "document" | "localStorage" | "fetch">;
type CachedStars = { count: number; at: number };

function readCache({ win }: { win: StarsWindow }): CachedStars | null {
  try {
    const cached = JSON.parse(win.localStorage.getItem(STORAGE_KEY) ?? "null");
    return Number.isInteger(cached?.count) && Number.isFinite(cached?.at) ? cached : null;
  } catch {
    return null;
  }
}

function writeCache({ win, stars }: { win: StarsWindow; stars: CachedStars }) {
  try {
    win.localStorage.setItem(STORAGE_KEY, JSON.stringify(stars));
  } catch {
    /* Storage is optional: the next page asks GitHub again. */
  }
}

/** Writes a count into every GitHub link on the page: the header's and the mobile menu's. */
export function paintStars({ win, stars }: { win: Pick<Window, "document">; stars: number }) {
  win.document.querySelectorAll<HTMLElement>("[data-docs-github]").forEach((link) => {
    link.setAttribute("aria-label", githubLabel({ stars }));
    const count = link.querySelector<HTMLElement>("[data-docs-stars-count]");
    if (count) count.textContent = formatStars({ stars });
    const wrapper = link.querySelector<HTMLElement>("[data-docs-stars]");
    if (wrapper) wrapper.hidden = false;
  });
}

async function fetchStars({ win }: { win: StarsWindow }) {
  try {
    const response = await win.fetch(REPOSITORY_URL, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const count = (await response.json()).stargazers_count;
    return Number.isInteger(count) ? (count as number) : null;
  } catch {
    return null;
  }
}

/**
 * Replaces the build's star count with a live one. A count this browser read within the hour is
 * used as it is; an older one is painted at once and refreshed from GitHub. If GitHub does not
 * answer, the page keeps the count it has.
 */
export async function refreshStars({
  win = window,
  // The performance clock gives epoch milliseconds without pulling Temporal into this island.
  now = Math.round(performance.timeOrigin + performance.now()),
}: { win?: StarsWindow; now?: number } = {}) {
  const cached = readCache({ win });
  if (cached) paintStars({ win, stars: cached.count });
  if (cached && now - cached.at < STARS_FRESH_MS) return;
  const count = await fetchStars({ win });
  if (count === null) return;
  writeCache({ win, stars: { count, at: now } });
  paintStars({ win, stars: count });
}

/** Paints the cached count again after an in-place navigation swaps the mobile menu. */
export function repaintCachedStars({ win = window }: { win?: StarsWindow } = {}) {
  const cached = readCache({ win });
  if (cached) paintStars({ win, stars: cached.count });
}

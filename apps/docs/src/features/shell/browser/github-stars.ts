import { GITHUB_ACCEPT, REPOSITORY_API_URL, starCount } from "../../../lib/github-repository.ts";
import { formatStars, githubLabel } from "../model/github-stars.ts";

const STORAGE_KEY = "lw-docs:github-stars";
/* A star count an hour old still reads right. GitHub's anonymous limit is per address, so
   readers behind one shared address can still spend it; the build's count then stays. */
export const STARS_FRESH_MS = 60 * 60 * 1000;

type StarsWindow = Pick<Window, "document" | "localStorage" | "fetch">;
/* `count` is null when GitHub was asked at `at` but gave no count: the next ask waits the hour. */
type CachedStars = { count: number | null; at: number };

function readCache({ win }: { win: StarsWindow }): CachedStars | null {
  try {
    const cached = JSON.parse(win.localStorage.getItem(STORAGE_KEY) ?? "null");
    const count = cached?.count === null || Number.isInteger(cached?.count);
    return count && Number.isFinite(cached?.at) ? cached : null;
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
function paintStars({ win, stars }: { win: Pick<Window, "document">; stars: number }) {
  win.document.querySelectorAll<HTMLElement>("[data-docs-github]").forEach((link) => {
    link.setAttribute("aria-label", githubLabel({ stars }));
    const count = link.querySelector<HTMLElement>("[data-docs-stars-count]");
    if (count) count.textContent = formatStars({ stars });
    const wrapper = link.querySelector<HTMLElement>("[data-docs-stars]");
    if (wrapper) wrapper.hidden = false;
  });
}

/** Whether the page shows the count GitHub reported at build time. */
function builtCount({ win }: { win: Pick<Window, "document"> }) {
  return [...win.document.querySelectorAll<HTMLElement>("[data-docs-github]")].some(
    (link) => link.querySelector<HTMLElement>("[data-docs-stars]")?.hidden === false,
  );
}

async function fetchStars({ win }: { win: StarsWindow }) {
  try {
    const response = await win.fetch(REPOSITORY_API_URL, {
      signal: AbortSignal.timeout(4000),
      headers: { accept: GITHUB_ACCEPT },
    });
    return response.ok ? starCount({ body: await response.json() }) : null;
  } catch {
    return null;
  }
}

let inFlight: Promise<void> | undefined;

/**
 * Replaces the build's star count with a live one. A count this browser read within the hour is
 * used as it is; an older one stands in only on a page built without a count. If GitHub does not
 * answer, the page keeps the count it has and asks again after the hour. One ask at a time.
 */
export function refreshStars(options: { win?: StarsWindow; now?: number } = {}) {
  inFlight ??= askAndPaint(options).finally(() => (inFlight = undefined));
  return inFlight;
}

async function askAndPaint({
  win = window,
  // The performance clock gives epoch milliseconds without pulling Temporal into this island.
  now = Math.round(performance.timeOrigin + performance.now()),
}: { win?: StarsWindow; now?: number } = {}) {
  const cached = readCache({ win });
  const fresh = cached !== null && now - cached.at < STARS_FRESH_MS;
  const fallback = fresh || !builtCount({ win }) ? (cached?.count ?? null) : null;
  if (fallback !== null) paintStars({ win, stars: fallback });
  if (fresh) return;
  const count = await fetchStars({ win });
  writeCache({ win, stars: { count: count ?? fallback, at: now } });
  if (count !== null) paintStars({ win, stars: count });
}

import { followSystemTheme } from "../../../lib/theme.ts";
import { startCookieNotice } from "./cookie-notice.ts";
import { refreshStars } from "./github-stars.ts";
import { prepareReadingLayout } from "./reading-layout.ts";
import { startTagManager } from "./tag-manager.ts";

let scheduled = false;
let lastCurrent: string | undefined;

/** What a scroll frame needs, measured once per layout instead of on every frame. */
type Rail = { path: SVGPathElement; spans: { start: number; end: number }[]; total: number };
type Layout = {
  links: HTMLAnchorElement[];
  headings: HTMLElement[];
  ticks: { tick: HTMLAnchorElement; heading: HTMLElement | null }[];
  rails: Rail[];
};
let layout: Layout = { links: [], headings: [], ticks: [], rails: [] };

function idOf({ link }: { link: HTMLAnchorElement }) {
  return decodeURIComponent(link.hash.slice(1));
}

/** Reads every position first, then writes: one layout per frame, no writes when nothing moved. */
function updateToc() {
  scheduled = false;
  const line = innerHeight * 0.25;
  let current = layout.headings[0]?.id;
  for (const heading of layout.headings) {
    if (heading.getBoundingClientRect().top <= line) current = heading.id;
  }
  const passed = layout.ticks.map(
    ({ heading }) => heading !== null && heading.getBoundingClientRect().top <= line,
  );
  const scrollable = document.documentElement.scrollHeight - innerHeight;
  const progress = scrollable > 0 ? Math.min(1, scrollY / scrollable) : 1;
  document.documentElement.style.setProperty("--docs-progress", progress.toFixed(4));
  if (current === lastCurrent) return;
  lastCurrent = current;
  for (const link of layout.links) {
    if (idOf({ link }) === current) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
  const index = layout.links.findIndex((link) => idOf({ link }) === current);
  for (const rail of layout.rails) paintProgress({ rail, index });
  const title =
    layout.headings.find((heading) => heading.id === current)?.textContent?.trim() ?? "";
  document.querySelectorAll(".docs-toc-current").forEach((label) => {
    if (label.textContent !== title) label.textContent = title;
  });
  markTrack({ current, passed });
  revealActive();
}

/** Keeps the pinned contents rail's current entry in view as the reader scrolls. */
function revealActive() {
  const rail = document.querySelector<HTMLElement>(".docs-toc-container");
  const link = rail?.querySelector<HTMLElement>('[aria-current="location"]');
  if (!rail || !link || rail.scrollHeight <= rail.clientHeight) return;
  const box = rail.getBoundingClientRect();
  const target = link.getBoundingClientRect();
  if (target.top >= box.top + 24 && target.bottom <= box.bottom - 24) return;
  rail.scrollTo({ top: rail.scrollTop + target.top - box.top - box.height / 3 });
}

/** The tablet reading track: one tick per top-level section, placed by where it starts. */
function buildTrack() {
  document.querySelector(".docs-progress-track")?.remove();
  const sections = [...document.querySelectorAll<HTMLAnchorElement>(".docs-toc-rail a")].filter(
    (link) => link.dataset.nested !== "true",
  );
  if (sections.length < 2) return;
  const track = document.createElement("nav");
  track.className = "docs-progress-track";
  track.setAttribute("aria-label", "Reading position");
  const total = document.documentElement.scrollHeight;
  for (const section of sections) {
    const heading = document.getElementById(idOf({ link: section }));
    if (!heading) continue;
    const tick = document.createElement("a");
    tick.href = section.hash;
    tick.title = section.textContent?.trim() ?? "";
    tick.setAttribute("aria-label", tick.title);
    tick.style.top = `${((heading.getBoundingClientRect().top + scrollY) / total) * 100}%`;
    track.append(tick);
  }
  (document.querySelector(".docs-shell") ?? document.body).append(track);
}

function markTrack({ current, passed }: { current?: string; passed: boolean[] }) {
  let marked: HTMLAnchorElement | null = null;
  layout.ticks.forEach(({ tick }, index) => {
    if (passed[index]) marked = tick;
    if (idOf({ link: tick }) === current) marked = tick;
  });
  for (const { tick } of layout.ticks) {
    if (tick === marked) tick.setAttribute("aria-current", "location");
    else tick.removeAttribute("aria-current");
  }
}

/** Draws a rail's curve once and records where each entry starts and ends along it. */
function measureRail(rail: HTMLElement): Rail | null {
  const track = rail.querySelector<HTMLElement>(".docs-toc-track");
  const svg = rail.querySelector<SVGSVGElement>(".docs-toc-progress");
  const path = svg?.querySelector<SVGPathElement>(".docs-toc-path");
  const guide = svg?.querySelector<SVGPathElement>(".docs-toc-guide");
  if (!track || !svg || !path || !guide) return null;
  const links = [...track.querySelectorAll<HTMLElement>("a")];
  const bounds = track.getBoundingClientRect();
  if (bounds.height <= 0) return null;
  const entries = links.map((link) => ({
    x: link.dataset.nested === "true" ? 16 : 4,
    y: link.getBoundingClientRect().top - bounds.top + 4,
    height: Math.max(0, link.offsetHeight - 8),
  }));
  let previous: { x: number; y: number } | null = null;
  const commands: string[] = [];
  const shapes: { start: string; end: string }[] = [];
  for (const entry of entries) {
    if (previous) {
      const middle = (previous.y + entry.y) / 2;
      commands.push(`C ${previous.x} ${middle} ${entry.x} ${middle} ${entry.x} ${entry.y}`);
    } else commands.push(`M ${entry.x} ${entry.y}`);
    const start = commands.join(" ");
    commands.push(`L ${entry.x} ${entry.y + entry.height}`);
    shapes.push({ start, end: commands.join(" ") });
    previous = { x: entry.x, y: entry.y + entry.height };
  }
  svg.setAttribute("viewBox", `0 0 28 ${bounds.height}`);
  const length = ({ d }: { d: string }) => {
    guide.setAttribute("d", d);
    return guide.getTotalLength();
  };
  const spans = shapes.map((shape) => ({
    start: length({ d: shape.start }),
    end: length({ d: shape.end }),
  }));
  const shape = commands.join(" ");
  const total = length({ d: shape });
  if (path.getAttribute("d") !== shape) path.setAttribute("d", shape);
  return { path, spans, total };
}

function paintProgress({ rail, index }: { rail: Rail; index: number }) {
  const span = rail.spans[index] ?? { start: 0, end: 0 };
  rail.path.style.strokeDasharray = `0 ${span.start} ${span.end - span.start} ${rail.total}`;
  rail.path.style.strokeDashoffset = "0";
}

/** Re-measures after anything that moves headings: a page swap, a resize, fonts arriving. */
function measure() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-docs-toc] a")];
  const headings = links
    .map((link) => document.getElementById(idOf({ link })))
    .filter((node) => node !== null);
  buildTrack();
  const ticks = [...document.querySelectorAll<HTMLAnchorElement>(".docs-progress-track a")].map(
    (tick) => ({ tick, heading: document.getElementById(idOf({ link: tick })) }),
  );
  const rails = [...document.querySelectorAll<HTMLElement>(".docs-toc-rail")]
    .map(measureRail)
    .filter((rail) => rail !== null);
  layout = { links, headings, ticks, rails };
  lastCurrent = undefined;
}

/** After a # link's scroll settles, the heading it reached glints once so the eye finds it. */
function glint({ id }: { id: string }) {
  const target = document.getElementById(id);
  if (!target) return;
  let done = false;
  const shine = () => {
    if (done) return;
    done = true;
    target.classList.remove("docs-glint");
    void target.offsetWidth;
    target.classList.add("docs-glint");
    target.addEventListener("animationend", () => target.classList.remove("docs-glint"), {
      once: true,
    });
  };
  addEventListener("scrollend", shine, { once: true });
  setTimeout(shine, 900);
}

export function installToc() {
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link?.hash || link.pathname !== location.pathname || link.origin !== location.origin)
      return;
    glint({ id: decodeURIComponent(link.hash.slice(1)) });
  });
  document.addEventListener(
    "scroll",
    () => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(updateToc);
      }
    },
    { passive: true },
  );
  const refresh = () => {
    measure();
    updateToc();
  };
  document.addEventListener("docs:navigated", refresh);
  window.addEventListener("resize", refresh);
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("[data-docs-toc] a") : null;
    link?.closest("details")?.removeAttribute("open");
  });
  refresh();
  void document.fonts.ready.then(refresh);
}

installToc();

prepareReadingLayout();

/* The idle island every page loads, so the tag never joins the initial bundle. */
startTagManager();
startCookieNotice();

/* The build's star count goes stale between deploys: refresh it once the page is idle. */
void refreshStars();
document.addEventListener("docs:navigated", () => void refreshStars());

/* A reader on the system theme follows their operating system when it switches. */
followSystemTheme();

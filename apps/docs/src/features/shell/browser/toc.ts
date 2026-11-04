import { prepareReadingLayout } from "./reading-layout.ts";
import { startTagManager } from "./tag-manager.ts";

let scheduled = false;
function updateToc() {
  scheduled = false;
  const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-docs-toc] a")];
  const headings = links
    .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
    .filter((node) => node !== null);
  let current = headings[0]?.id;
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top <= innerHeight * 0.25) current = heading.id;
  }
  for (const link of links) {
    if (decodeURIComponent(link.hash.slice(1)) === current)
      link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
  document.querySelectorAll<HTMLElement>(".docs-toc-rail").forEach(updateProgress);
  const scrollable = document.documentElement.scrollHeight - innerHeight;
  const progress = scrollable > 0 ? Math.min(1, scrollY / scrollable) : 1;
  document.documentElement.style.setProperty("--docs-progress", progress.toFixed(4));
  const title = headings.find((heading) => heading.id === current)?.textContent?.trim() ?? "";
  document.querySelectorAll(".docs-toc-current").forEach((label) => {
    if (label.textContent !== title) label.textContent = title;
  });
  revealActive();
  markTrack({ current });
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
    const heading = document.getElementById(decodeURIComponent(section.hash.slice(1)));
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

function markTrack({ current }: { current?: string }) {
  const ticks = document.querySelectorAll<HTMLAnchorElement>(".docs-progress-track a");
  let marked: HTMLAnchorElement | null = null;
  for (const tick of ticks) {
    tick.removeAttribute("aria-current");
    const heading = document.getElementById(decodeURIComponent(tick.hash.slice(1)));
    if (heading && heading.getBoundingClientRect().top <= innerHeight * 0.25) marked = tick;
    if (decodeURIComponent(tick.hash.slice(1)) === current) marked = tick;
  }
  marked?.setAttribute("aria-current", "location");
}
function updateProgress(rail: HTMLElement) {
  const track = rail.querySelector<HTMLElement>(".docs-toc-track");
  const svg = rail.querySelector<SVGSVGElement>(".docs-toc-progress");
  const path = svg?.querySelector<SVGPathElement>(".docs-toc-path");
  const guide = svg?.querySelector<SVGPathElement>(".docs-toc-guide");
  if (!track || !svg || !path || !guide) return;
  const links = [...track.querySelectorAll<HTMLElement>("a")];
  const bounds = track.getBoundingClientRect();
  if (bounds.height <= 0) return;
  const entries = links.map((link) => ({
    x: link.dataset.nested === "true" ? 16 : 4,
    y: link.getBoundingClientRect().top - bounds.top + 4,
    height: Math.max(0, link.offsetHeight - 8),
  }));
  let previous: { x: number; y: number } | null = null;
  let activeStartShape = "";
  let activeEndShape = "";
  const commands: string[] = [];
  entries.forEach((entry, index) => {
    if (previous) {
      const middle = (previous.y + entry.y) / 2;
      commands.push(`C ${previous.x} ${middle} ${entry.x} ${middle} ${entry.x} ${entry.y}`);
    } else commands.push(`M ${entry.x} ${entry.y}`);
    const active = links[index]?.getAttribute("aria-current") === "location";
    if (active) activeStartShape = commands.join(" ");
    commands.push(`L ${entry.x} ${entry.y + entry.height}`);
    if (active) activeEndShape = commands.join(" ");
    previous = { x: entry.x, y: entry.y + entry.height };
  });
  svg.setAttribute("viewBox", `0 0 28 ${bounds.height}`);
  const shape = commands.join(" ");
  guide.setAttribute("d", activeStartShape);
  const activeStart = activeStartShape ? guide.getTotalLength() : 0;
  guide.setAttribute("d", activeEndShape);
  const activeEnd = activeEndShape ? guide.getTotalLength() : 0;
  guide.setAttribute("d", shape);
  if (path.getAttribute("d") !== shape) path.setAttribute("d", shape);
  path.style.strokeDasharray = `0 ${activeStart} ${activeEnd - activeStart} ${guide.getTotalLength()}`;
  path.style.strokeDashoffset = "0";
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
    buildTrack();
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

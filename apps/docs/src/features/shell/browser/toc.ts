import { prepareReadingLayout } from "./reading-layout.ts";

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
    const active = links[index].getAttribute("aria-current") === "location";
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

export function installToc() {
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
  document.addEventListener("docs:navigated", updateToc);
  window.addEventListener("resize", updateToc);
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("[data-docs-toc] a") : null;
    link?.closest("details")?.removeAttribute("open");
  });
  updateToc();
  void document.fonts.ready.then(updateToc);
}

installToc();

prepareReadingLayout();

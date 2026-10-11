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
  const path = svg?.querySelector<SVGPathElement>("path");
  const active = track?.querySelector<HTMLElement>('[aria-current="location"]');
  if (!track || !svg || !path || !active) return;
  const bounds = track.getBoundingClientRect();
  const top = active.getBoundingClientRect().top - bounds.top + 4;
  svg.setAttribute("viewBox", `0 0 14 ${bounds.height}`);
  path.setAttribute("d", `M 4 ${top} L 4 ${top + active.offsetHeight - 8}`);
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
}

installToc();

prepareReadingLayout();

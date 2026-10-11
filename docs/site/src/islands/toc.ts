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
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("[data-docs-toc] a") : null;
    link?.closest("details")?.removeAttribute("open");
  });
  updateToc();
}

installToc();

prepareReadingLayout();

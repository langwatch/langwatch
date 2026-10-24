import { slide } from "../../../lib/slide.ts";

document.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("button") : null;
  if (!button) return;
  if (button.matches("[data-docs-agent]")) {
    const region = button.closest(".docs-agent-start");
    region
      ?.querySelectorAll("[data-docs-agent]")
      .forEach((node) => node.setAttribute("aria-pressed", String(node === button)));
    const name = region?.querySelector("[data-docs-agent-name]");
    if (name) name.textContent = button.dataset.docsAgent ?? "";
  }
  if (button.matches('[aria-label="Dismiss announcement"], [data-docs-dismiss]')) {
    const banner = button.closest<HTMLElement>("[data-docs-banner]");
    if (banner) {
      try {
        localStorage.setItem(`lw-docs:${banner.dataset.docsBanner}`, "dismissed");
      } catch {
        /* Storage is optional. */
      }
      banner.remove();
    }
  }
  if (button.matches('nav[aria-label="Page navigation"] button[aria-expanded]'))
    toggleGroup({ button });
  if (button.matches("[data-docs-theme]")) toggleTheme({ button });
});

/** Flips light and dark; the new theme spreads from the button in a growing circle. */
function toggleTheme({ button }: { button: HTMLElement }) {
  const root = document.documentElement;
  const dark = !root.classList.contains("dark");
  const apply = () => {
    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
    root.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      /* Storage is optional. */
    }
  };
  if (
    !document.startViewTransition ||
    !matchMedia("(prefers-reduced-motion: no-preference)").matches
  )
    return apply();
  const box = button.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.dataset.docsThemeChange = "";
  const transition = document.startViewTransition(apply);
  void transition.ready.then(() =>
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      {
        duration: 520,
        easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
        pseudoElement: "::view-transition-new(root)",
      },
    ),
  );
  void transition.finished.finally(() => delete root.dataset.docsThemeChange);
}

function toggleGroup({ button }: { button: HTMLButtonElement }) {
  const panel = button.nextElementSibling;
  const open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(open));
  const icon = button.querySelector("svg");
  if (icon) icon.style.transform = open ? "rotate(90deg)" : "";
  if (panel instanceof HTMLElement) slide({ panel, open });
}

/** The reader's theme: `system` follows the operating system's colour scheme. */
export type ThemeChoice = "system" | "light" | "dark";

const THEME_CHOICES: readonly string[] = ["system", "light", "dark"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Paints the page light or dark and stores the reader's choice: `light`, `dark` or `system`. */
export function applyTheme({ dark, choice }: { dark: boolean; choice: string }) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.style.colorScheme = dark ? "dark" : "light";
  try {
    localStorage.setItem("theme", choice);
  } catch {
    /* Storage is optional. */
  }
}

/** The stored choice; nothing stored, an unknown value or refused storage is `system`. */
export function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem("theme") ?? "system";
    return THEME_CHOICES.includes(value) ? (value as ThemeChoice) : "system";
  } catch {
    return "system";
  }
}

/** Whether a choice paints dark; `system` reads the operating system's colour scheme now. */
function choiceIsDark({ choice }: { choice: ThemeChoice }) {
  return choice === "dark" || (choice === "system" && matchMedia(DARK_QUERY).matches);
}

/**
 * Applies a theme choice. When the page changes between light and dark, the new theme spreads in
 * a growing circle from `origin`; reduced motion, or a browser without view transitions, snaps.
 */
export function chooseTheme({ choice, origin }: { choice: ThemeChoice; origin?: HTMLElement }) {
  const root = document.documentElement;
  const dark = choiceIsDark({ choice });
  const apply = () => applyTheme({ dark, choice });
  if (
    !origin ||
    dark === root.classList.contains("dark") ||
    !document.startViewTransition ||
    !matchMedia("(prefers-reduced-motion: no-preference)").matches
  )
    return apply();
  const box = origin.getBoundingClientRect();
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

/** Keeps a `system` page in step when the operating system switches between light and dark. */
export function followSystemTheme() {
  matchMedia(DARK_QUERY).addEventListener("change", (event) => {
    if (storedTheme() === "system") applyTheme({ dark: event.matches, choice: "system" });
  });
}

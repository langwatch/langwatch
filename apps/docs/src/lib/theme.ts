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

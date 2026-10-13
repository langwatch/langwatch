export type ThemeChoice = "system" | "light" | "dark";

/** Shared by every console, so a choice made in one holds in all of them on the same host. */
export const THEME_STORAGE_KEY = "lw-internal-theme";

const isThemeChoice = (value: string | null): value is ThemeChoice =>
  value === "system" || value === "light" || value === "dark";

export const readThemeChoice = (): ThemeChoice => {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeChoice(stored) ? stored : "system";
};

/** Sets `data-theme` on <html>; `system` removes it and lets the media query decide. */
export const applyThemeChoice = ({ choice }: { choice: ThemeChoice }): void => {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
};

export const saveThemeChoice = ({ choice }: { choice: ThemeChoice }): void => {
  window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  applyThemeChoice({ choice });
};

/** Call once in a console's entry, before the first render, so a dark page never flashes light. */
export const initTheme = (): void => applyThemeChoice({ choice: readThemeChoice() });

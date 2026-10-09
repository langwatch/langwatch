/** The design system's ColorModeProvider leaves next-themes on its default storage key. */
export const THEME_KEY = "theme";
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_LABELS: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
const HIDDEN_KEY = "haven-orb:hidden";

/** Stores the theme and tells next-themes, which listens for storage events on its key. */
export function setTheme({ host, theme }: { host: Window; theme: Theme }): void {
  host.localStorage.setItem(THEME_KEY, theme);
  host.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY, newValue: theme }));
}

export const currentTheme = ({ host }: { host: Window }): string =>
  host.localStorage.getItem(THEME_KEY) ?? "system";

/** Hidden lasts as long as the tab's session, so a new tab shows the orb again. */
export const hideForSession = ({ host }: { host: Window }): void =>
  host.sessionStorage.setItem(HIDDEN_KEY, "1");

export const isHiddenForSession = ({ host }: { host: Window }): boolean =>
  host.sessionStorage.getItem(HIDDEN_KEY) === "1";

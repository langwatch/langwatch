const HIDDEN_KEY = "haven-orb:hidden";

/** Hidden lasts as long as the tab's session, so a new tab shows the orb again. */
export const hideForSession = ({ host }: { host: Window }): void =>
  host.sessionStorage.setItem(HIDDEN_KEY, "1");

export const isHiddenForSession = ({ host }: { host: Window }): boolean =>
  host.sessionStorage.getItem(HIDDEN_KEY) === "1";

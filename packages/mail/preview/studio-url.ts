import type { Density } from "./gallery-view";
import type { PreviewScheme, WIDTHS } from "./studio-shared";

export type View = "inspect" | "gallery";

export interface UrlState {
  view: View;
  templateId: string | null;
  fixtureName: string | null;
  width: keyof typeof WIDTHS;
  density: Density;
  theme: PreviewScheme;
  everyFixture: boolean;
}

const PROPS_KEY = "props";

/** What the address bar shows when nothing in it says otherwise. */
export const DEFAULT_URL_STATE: UrlState = {
  view: "inspect",
  templateId: null,
  fixtureName: null,
  width: "desktop",
  density: "comfortable",
  theme: "system",
  everyFixture: false,
};

export const parseUrlState = (search: string): UrlState => {
  const params = new URLSearchParams(search);
  const theme = params.get("theme");
  return {
    view: params.get("view") === "gallery" ? "gallery" : "inspect",
    templateId: params.get("template"),
    fixtureName: params.get("fixture"),
    width: params.get("width") === "mobile" ? "mobile" : "desktop",
    density: params.get("density") === "compact" ? "compact" : "comfortable",
    theme: theme === "light" || theme === "dark" ? theme : "system",
    everyFixture: params.get("fixtures") === "all",
  };
};

export const buildSearch = (state: UrlState): string => {
  const params = new URLSearchParams();
  params.set("view", state.view);
  if (state.templateId) params.set("template", state.templateId);
  if (state.fixtureName) params.set("fixture", state.fixtureName);
  params.set("width", state.width);
  params.set("density", state.density);
  params.set("theme", state.theme);
  if (state.everyFixture) params.set("fixtures", "all");
  return `?${params.toString()}`;
};

const toBase64Url = (json: string): string => {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (encoded: string): string => {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/** The fragment a pasted link carries: the edited props, not just their fixture name. */
export const encodePropsFragment = (props: unknown): string =>
  `#${PROPS_KEY}=${toBase64Url(JSON.stringify(props ?? null))}`;

/** A fragment nobody hand-typed correctly falls back to the fixture, not a crash. */
export const decodePropsFragment = (hash: string): unknown | undefined => {
  const encoded = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get(PROPS_KEY);
  if (!encoded) return undefined;
  try {
    return JSON.parse(fromBase64Url(encoded));
  } catch {
    return undefined;
  }
};

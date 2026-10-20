import { GLOBALS_UPDATED, SET_GLOBALS, STORY_PREPARED } from "storybook/internal/core-events";
import { addons } from "storybook/manager-api";

import { paperTheme, schemeFor } from "./theme.ts";

const MODE_KEY = "langwatch-design-system:color-mode";
const remembered = () => window.localStorage.getItem(MODE_KEY) ?? "system";

addons.setConfig({ theme: paperTheme({ scheme: schemeFor(remembered()) }) });

/** The manager wears the toolbar's colour mode, follows the OS on "System", remembers the pick. */
addons.register("langwatch/manager-follows-color-mode", (api) => {
  let mode = remembered();
  const paint = () => api.setOptions({ theme: paperTheme({ scheme: schemeFor(mode) }) });
  api.on(SET_GLOBALS, ({ globals }: { globals: Record<string, unknown> }) => {
    const inUrl = new URLSearchParams(window.location.search)
      .get("globals")
      ?.includes("colorMode:");
    if (!inUrl && globals.colorMode !== mode) api.updateGlobals({ colorMode: mode });
  });
  api.on(GLOBALS_UPDATED, ({ globals }: { globals: Record<string, unknown> }) => {
    if (typeof globals.colorMode !== "string" || globals.colorMode === mode) return;
    mode = globals.colorMode;
    window.localStorage.setItem(MODE_KEY, mode);
    paint();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (mode === "system") paint();
  });
});

/** A story with nothing to control (tokens, pages) gets the canvas, not an empty panel. */
addons.register("langwatch/panel-follows-controls", (api) => {
  api.on(STORY_PREPARED, ({ argTypes }: { argTypes?: Record<string, unknown> }) => {
    if (api.getUrlState().viewMode !== "story") return;
    api.togglePanel(Object.keys(argTypes ?? {}).length > 0);
  });
});

import { STORY_PREPARED } from "storybook/internal/core-events";
import { addons } from "storybook/manager-api";

import { paperTheme, pickScheme } from "./theme.ts";

addons.setConfig({ theme: paperTheme({ scheme: pickScheme() }) });

/** A story with nothing to control (tokens, pages) gets the canvas, not an empty panel. */
addons.register("langwatch/panel-follows-controls", (api) => {
  api.on(STORY_PREPARED, ({ argTypes }: { argTypes?: Record<string, unknown> }) => {
    if (api.getUrlState().viewMode !== "story") return;
    api.togglePanel(Object.keys(argTypes ?? {}).length > 0);
  });
});

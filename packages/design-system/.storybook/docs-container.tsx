import { DocsContainer, type DocsContainerProps } from "@storybook/addon-docs/blocks";
import { useEffect, useState } from "react";
import { GLOBALS_UPDATED, SET_GLOBALS } from "storybook/internal/core-events";
import { addons } from "storybook/preview-api";

import { paperTheme, schemeFor } from "./theme.ts";

/** `globals=colorMode:dark;…` on the preview's URL, which the manager sets on every load. */
const modeInUrl = () =>
  new URLSearchParams(window.location.search)
    .get("globals")
    ?.split(";")
    .find((pair) => pair.startsWith("colorMode:"))
    ?.slice("colorMode:".length);

/** Docs pages wear the scheme the toolbar picked, so their text matches the stories in them. */
export function ThemedDocsContainer(props: DocsContainerProps) {
  const [mode, setMode] = useState<unknown>(modeInUrl);
  useEffect(() => {
    const channel = addons.getChannel();
    const update = ({ globals }: { globals: Record<string, unknown> }) =>
      setMode(globals.colorMode);
    channel.on(SET_GLOBALS, update);
    channel.on(GLOBALS_UPDATED, update);
    return () => {
      channel.off(SET_GLOBALS, update);
      channel.off(GLOBALS_UPDATED, update);
    };
  }, []);
  return <DocsContainer {...props} theme={paperTheme({ scheme: schemeFor(mode) })} />;
}

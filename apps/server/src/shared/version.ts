declare const __LANGWATCH_VERSION__: string;

/** This CLI's release; scripts/build.ts stamps it into the bundle, a source run is a dev build. */
export const CLI_VERSION =
  typeof __LANGWATCH_VERSION__ !== "undefined" ? __LANGWATCH_VERSION__ : "0.0.0-dev";

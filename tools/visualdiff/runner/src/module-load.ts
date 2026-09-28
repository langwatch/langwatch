import type { CaptureMessage } from "./protocol";

/** Vite serves the app's own modules on these paths; their failure is the dev server's. */
const VITE_MODULE_PATTERN = /\/@fs\/|\/@id\/|\/@vite\/|\/@react-refresh|\/node_modules\/\.vite\//;

/** The browser's own words when an ES module or a dynamic import could not be fetched. */
const MODULE_CONSOLE_PATTERN =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script/i;

/**
 * isModuleRequest is a request for one of the app's own modules: a script
 * from the side's own origin, or a Vite module path.
 */
export const isModuleRequest = ({
  url,
  resourceType,
  origin,
}: {
  url: string;
  resourceType: string;
  origin: string;
}): boolean =>
  url.startsWith(origin) && (resourceType === "script" || VITE_MODULE_PATTERN.test(url));

/** isModuleConsoleError is the console line of a module the page could not import. */
export const isModuleConsoleError = (text: string): boolean => MODULE_CONSOLE_PATTERN.test(text);

/**
 * needsRecapture is a capture the concurrency may have spoiled: a page with
 * no text, or one whose own modules failed to load. It is taken again, alone.
 */
export const needsRecapture = (capture: CaptureMessage): boolean =>
  capture.blank || (capture.moduleFailures?.length ?? 0) > 0;

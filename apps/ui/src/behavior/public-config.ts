/**
 * The browser's half of the public config: reads the HTML shell's meta
 * tag. Imports nothing from the runtime-config projection — without
 * `sideEffects: false`, that would leak secret variable NAMES into the bundle.
 */
import {
  parsePublicAppConfigMetaContent,
  PUBLIC_APP_CONFIG_META_NAME,
  type PublicAppConfig,
} from "@langwatch/config/public-app-config";

export { type PublicEnvironment } from "../model/public-environment";
export { toPublicEnvironment } from "./public-environment";

export function readPublicAppConfig(
  documentRoot: {
    querySelector(selector: string): { getAttribute(name: string): string | null } | null;
  } = document,
): PublicAppConfig {
  const element = documentRoot.querySelector(`meta[name="${PUBLIC_APP_CONFIG_META_NAME}"]`);
  const content = element?.getAttribute("content");
  if (!content) {
    throw new Error(
      "Public application config is missing from the HTML shell. The web boot boundary must inject it before the client starts.",
    );
  }
  return parsePublicAppConfigMetaContent(content);
}

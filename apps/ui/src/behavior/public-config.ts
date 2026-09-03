/**
 * The browser's half of the public application config: reading it back out of
 * the HTML shell the API served.
 *
 * Only this half is here. The contract, the meta tag and its encoding are
 * `@langwatch/config/public-app-config`, because the process that WRITES the
 * tag is the API and a backend graph may not be rooted in a browser
 * application. What is left is the one thing that genuinely belongs to a
 * browser: a `document` query.
 *
 * It still imports nothing from the projection. That module declares the
 * deployment's full runtime configuration at module scope, including the NAMES
 * of secret variables — `SENDGRID_API_KEY`, `RESEND_API_KEY`, `SMTP_URL` — and
 * `usePublicEnv` imports this subpath. Neither package sets
 * `sideEffects: false`, so a module-scope `RuntimeConfig.define` does not
 * tree-shake away. The values never reached the browser; the variable names
 * and the whole config runtime did.
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

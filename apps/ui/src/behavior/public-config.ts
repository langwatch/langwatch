/**
 * The browser's half of the public application config: the schema, the meta-tag
 * carrier, and the reader that parses it back out of the shell.
 *
 * Deliberately imports nothing from `./public-config.projection`. That module
 * declares the deployment's full runtime configuration at module scope,
 * including the NAMES of secret variables — `SENDGRID_API_KEY`,
 * `RESEND_API_KEY`, `SMTP_URL`. Re-exporting it from here put all of that on
 * the browser's import graph, because `usePublicEnv` imports this subpath and
 * neither this package nor `@langwatch/config` sets `sideEffects: false`, so a
 * module-scope `RuntimeConfig.define` does not tree-shake away.
 *
 * The values never reached the browser — there is no `process.env` there — but
 * the variable names and the whole config runtime did. Server code wanting the
 * projection imports `@langwatch/ui/public-config/projection` instead.
 */
import {
  PUBLIC_APP_CONFIG_META_NAME,
  publicAppConfigSchema,
  type PublicAppConfig,
} from "../model/public-config";

export { PUBLIC_APP_CONFIG_META_NAME } from "../model/public-config";
export { publicAppConfigSchema, type PublicAppConfig } from "../model/public-config";
export { type PublicEnvironment } from "../model/public-environment";
export { toPublicEnvironment } from "./public-environment";

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    const bits = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += BASE64URL_ALPHABET[(bits >>> 18) & 63];
    encoded += BASE64URL_ALPHABET[(bits >>> 12) & 63];
    if (second !== void 0) encoded += BASE64URL_ALPHABET[(bits >>> 6) & 63];
    if (third !== void 0) encoded += BASE64URL_ALPHABET[bits & 63];
  }
  return encoded;
}

function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("Public application config has an invalid encoding.");
  }
  const bytes: number[] = [];
  let buffer = 0;
  let availableBits = 0;
  for (const character of value) {
    buffer = (buffer << 6) | BASE64URL_ALPHABET.indexOf(character);
    availableBits += 6;
    if (availableBits >= 8) {
      availableBits -= 8;
      bytes.push((buffer >>> availableBits) & 255);
      buffer &= (1 << availableBits) - 1;
    }
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
}

export function injectPublicAppConfigIntoHtml({
  html,
  config,
}: {
  html: string;
  config: PublicAppConfig;
}): string {
  const element = createPublicAppConfigMetaTag(config);
  const headEnd = html.indexOf("</head>");
  if (headEnd < 0) throw new Error("Cannot inject public application config: </head> is missing.");
  return `${html.slice(0, headEnd)}${element}${html.slice(headEnd)}`;
}

export function createPublicAppConfigMetaTag(config: PublicAppConfig): string {
  const parsed = publicAppConfigSchema.parse(config);
  const payload = encodeBase64Url(JSON.stringify(parsed));
  return `<meta name="${PUBLIC_APP_CONFIG_META_NAME}" content="${payload}">`;
}

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
  return publicAppConfigSchema.parse(JSON.parse(decodeBase64Url(content)));
}

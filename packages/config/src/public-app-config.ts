/**
 * The public application config: the exact contract a browser is handed, and
 * the meta tag that carries it there.
 *
 * It lives in `@langwatch/config` because both ends of the wire need it and
 * they are different processes. The API process builds the tag and injects it
 * into the HTML shell it serves; the browser bundle reads it back out of the
 * document. While this lived in `apps/ui` the API's static surface was a
 * backend graph rooted in a browser application — the exact shape
 * `frontend-boundary.unit.test.ts` refuses, and one that would have gone
 * unnoticed until somebody put a React import in the module next door.
 *
 * Nothing here reads an environment variable. The projection that does is
 * `./public-app-config.projection`, and it is deliberately a separate module:
 * it declares the NAMES of the deployment's secret variables at module scope,
 * and this one is on the browser's import graph.
 *
 * `readPublicAppConfig` is not here either. It reaches for `document`, so it
 * belongs to the browser application; it decodes through
 * `parsePublicAppConfigMetaContent` below, so there is one encoding on both
 * sides of the tag rather than two that must agree.
 */
import { z } from "zod";

export const PUBLIC_APP_CONFIG_META_NAME = "langwatch-public-config";

export const publicAppConfigSchema = z.strictObject({
  appBaseUrl: z.string().min(1),
  gatewayBaseUrl: z.string().min(1),
  deployment: z.enum(["saas", "self-hosted"]),
  demoProjectSlug: z.string().min(1).optional(),
  mode: z.enum(["development", "test", "production"]),
  telemetry: z.strictObject({
    browserTracing: z.boolean(),
    sampleRatio: z.number().min(0).max(1),
    posthog: z
      .strictObject({
        key: z.string().min(1),
        host: z.string().min(1).optional(),
      })
      .optional(),
  }),
  capabilities: z.strictObject({
    email: z.boolean(),
    nlp: z.boolean(),
    langevals: z.boolean(),
  }),
  /**
   * Whether this deployment mounted the passkey plugin at boot. A derived
   * boolean rather than the raw setting, because the only thing a browser may
   * act on is "is there an endpoint behind the button".
   */
  passkeys: z.boolean(),
  /**
   * Whether the identifier-first screens are the front door on this
   * deployment (ADR-117 §7). Derived rather than the flag's value: the router
   * also runs in shadow, and the screens never render then.
   */
  identityFrontDoor: z.boolean(),
  licensePaymentUrl: z.string().min(1).optional(),
});

export type PublicAppConfig = z.infer<typeof publicAppConfigSchema>;

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

/** The `content` attribute of the meta tag, back as the contract it carries. */
export function parsePublicAppConfigMetaContent(content: string): PublicAppConfig {
  return publicAppConfigSchema.parse(JSON.parse(decodeBase64Url(content)));
}

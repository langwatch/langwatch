import { z } from "zod/v4";

export const PUBLIC_APP_CONFIG_META_NAME = "langwatch-public-config";

export const publicAppConfigSchema = z.object({
  appBaseUrl: z.string().min(1),
  gatewayBaseUrl: z.string().min(1),
  deployment: z.enum(["saas", "self-hosted"]),
  demoProjectSlug: z.string().min(1).optional(),
  mode: z.enum(["development", "test", "production"]),
  telemetry: z.object({
    browserTracing: z.boolean(),
    sampleRatio: z.number().min(0).max(1),
    posthog: z
      .object({
        key: z.string().min(1),
        host: z.string().min(1).optional(),
      })
      .optional(),
  }),
  capabilities: z.object({
    email: z.boolean(),
    nlp: z.boolean(),
    langevals: z.boolean(),
  }),
  licensePaymentUrl: z.string().min(1).optional(),
});

export type PublicAppConfig = z.infer<typeof publicAppConfigSchema>;

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const encodeBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    const bits = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += BASE64URL_ALPHABET[(bits >>> 18) & 63];
    encoded += BASE64URL_ALPHABET[(bits >>> 12) & 63];
    if (second !== undefined) encoded += BASE64URL_ALPHABET[(bits >>> 6) & 63];
    if (third !== undefined) encoded += BASE64URL_ALPHABET[bits & 63];
  }
  return encoded;
};

const decodeBase64Url = (value: string): string => {
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
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(bytes),
  );
};

/**
 * Adds inert, schema-validated configuration to the HTML document. A meta
 * element is used instead of executable inline JavaScript so values cannot
 * escape into the script context and deployments can keep a strict CSP.
 */
export const injectPublicAppConfigIntoHtml = ({
  html,
  config,
}: {
  html: string;
  config: PublicAppConfig;
}): string => {
  const parsed = publicAppConfigSchema.parse(config);
  const element = createPublicAppConfigMetaTag(parsed);
  const headEnd = html.indexOf("</head>");
  if (headEnd < 0) {
    throw new Error("Cannot inject public application config: </head> is missing.");
  }
  return `${html.slice(0, headEnd)}${element}${html.slice(headEnd)}`;
};

export const createPublicAppConfigMetaTag = (
  config: PublicAppConfig,
): string => {
  const parsed = publicAppConfigSchema.parse(config);
  const payload = encodeBase64Url(JSON.stringify(parsed));
  return `<meta name="${PUBLIC_APP_CONFIG_META_NAME}" content="${payload}">`;
};

/** Reads and validates the deployment configuration installed by the shell. */
export const readPublicAppConfig = (
  documentRoot: Pick<Document, "querySelector"> = document,
): PublicAppConfig => {
  const element = documentRoot.querySelector(
    `meta[name="${PUBLIC_APP_CONFIG_META_NAME}"]`,
  );
  const content = element?.getAttribute("content");
  if (!content) {
    throw new Error(
      "Public application config is missing from the HTML shell. The web boot boundary must inject it before the client starts.",
    );
  }
  return publicAppConfigSchema.parse(JSON.parse(decodeBase64Url(content)));
};

/**
 * Public application config: the exact contract a browser is handed. Lives in @langwatch/config
 * because both the API (builds and injects the meta tag) and browser (reads it) need it and they
 * are different processes. Does not read env vars; `./public-app-config.projection` does that.
 */
import { z, type input, type output, type ZodType } from "zod";

export const PUBLIC_APP_CONFIG_META_NAME = "langwatch-public-config";

/**
 * One slice per owner, keyed by the owner's name (ARCHITECTURE.md §6). The
 * envelope checks only the namespacing; each owner's schema judges its slice.
 */
export const publicAppConfigSchema = z.record(z.string().min(1), z.record(z.string(), z.unknown()));

export type PublicAppConfig = z.infer<typeof publicAppConfigSchema>;

/** The process owner's slice: the facts the process, not a module, knows. */
export const processWebConfigSchema = z.strictObject({
  appBaseUrl: z.string().min(1).optional(),
  mode: z.enum(["development", "test", "production"]),
  deployment: z.enum(["saas", "self-hosted"]),
  nlp: z.boolean(),
  browserTracing: z.boolean(),
  sampleRatio: z.number().min(0).max(1),
  /** Keeps the development badge off a development build (demos, screenshots). */
  hideDevIndicator: z.boolean().optional(),
});

export type ProcessWebConfig = z.infer<typeof processWebConfigSchema>;

/** A contract's browser projection: its schema, and its parsed slice to the values it admits. */
export type BrowserConfigDeclaration<Config, Schema extends ZodType> = Readonly<{
  schema: Schema;
  project: (config: Config) => output<Schema>;
}>;

/**
 * Declares an owner's browser projection. `project` reads the owner's parsed
 * config only, which never holds a secret (`ConfigClaimsSecretError`), and its
 * answer is parsed by the strict schema, so an undeclared key refuses boot.
 */
export function defineBrowserConfig<Config, Schema extends ZodType>(declaration: {
  schema: Schema;
  project: (config: Config) => input<Schema>;
}): BrowserConfigDeclaration<Config, Schema> {
  return {
    schema: declaration.schema,
    project: (config) => declaration.schema.parse(declaration.project(config)),
  };
}

/** One owner's slice of the page's config, through the schema that owner declared. */
export function parsePublicConfigSlice<Schema extends ZodType>({
  config,
  owner,
  schema,
}: {
  config: PublicAppConfig;
  owner: string;
  schema: Schema;
}): output<Schema> {
  const parsed = schema.safeParse(config[owner]);
  if (!parsed.success) {
    throw new Error(`The page's browser config for "${owner}" is missing or was refused.`);
  }
  return parsed.data;
}

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

/** Refuses anything not namespaced by owner before it reaches the page. */
export function createPublicAppConfigMetaTag(config: Readonly<Record<string, unknown>>): string {
  const parsed = publicAppConfigSchema.parse(config);
  const payload = encodeBase64Url(JSON.stringify(parsed));
  return `<meta name="${PUBLIC_APP_CONFIG_META_NAME}" content="${payload}">`;
}

/** The `content` attribute of the meta tag, back as the contract it carries. */
export function parsePublicAppConfigMetaContent(content: string): PublicAppConfig {
  return publicAppConfigSchema.parse(JSON.parse(decodeBase64Url(content)));
}

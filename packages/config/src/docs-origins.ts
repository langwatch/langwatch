/**
 * The documentation sites whose API playground may connect to this deployment (ADR-185).
 * api-key reads it to refuse a mint for any other site; the API host reads it to answer
 * cross-origin calls. One leaf, so the two can never disagree.
 */
import { z } from "zod";

import { Config } from "./config.ts";

/** LangWatch Cloud's documentation site: what a hosted deployment registers when it names none. */
export const SAAS_DOCS_ORIGIN = "https://langwatch.ai";

/** The origin a URL stands for, exactly as a browser reports it, or null when it is not one. */
export function canonicalOriginOf(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // URL keeps `*` in a host; a wildcard is never one origin.
  if (url.hostname.includes("*")) return null;

  return url.origin;
}

/** Whether `value` is already an exact origin: scheme, host and port, nothing else. */
export function isExactOrigin(value: string): boolean {
  return canonicalOriginOf(value) === value;
}

/**
 * `LANGWATCH_DOCS_ORIGINS`: exact origins, separated by commas or spaces. A wildcard, a path or
 * anything else that is not an origin refuses the boot by name rather than widening the list.
 */
export const { docsOrigins } = Config.define((c) => ({
  docsOrigins: c.env(
    "LANGWATCH_DOCS_ORIGINS",
    z
      .string()
      .optional()
      .transform((value) => {
        const entries = (value ?? "").split(/[\s,]+/).filter(Boolean);
        return entries.length === 0 ? void 0 : entries;
      })
      .superRefine((entries, context) => {
        const refused = (entries ?? []).filter((entry) => !isExactOrigin(entry));
        if (refused.length === 0) return;
        context.addIssue({
          code: "custom",
          message: `not an exact origin (scheme://host[:port], no path or wildcard): ${refused.join(", ")}`,
        });
      }),
  ),
}));

/**
 * Every origin a docs session may be handed to: the configured list (Cloud's site when a hosted
 * deployment names none), and always this deployment's own origin, where a same-host install
 * and haven serve the docs at `/docs`.
 */
export function registeredDocsOrigins({
  configured,
  isSaas,
  publicBaseUrl,
}: {
  configured: readonly string[] | undefined;
  isSaas: boolean;
  publicBaseUrl: string | undefined;
}): readonly string[] {
  const listed = configured ?? (isSaas ? [SAAS_DOCS_ORIGIN] : []);
  const own = publicBaseUrl ? canonicalOriginOf(publicBaseUrl) : null;

  return [...new Set([...listed, ...(own ? [own] : [])])];
}

/** Exact membership: no suffix, substring, wildcard or case folding. */
export function isRegisteredDocsOrigin({
  origin,
  registered,
}: {
  origin: string;
  registered: readonly string[];
}): boolean {
  return isExactOrigin(origin) && registered.includes(origin);
}

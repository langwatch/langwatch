/**
 * `{{ secrets.NAME }}` references in http target requests: url, headers, auth fields.
 * Mirroring engine semantics: rotate-aware at request-build time, resolve-blind refs left
 * verbatim, all values scrubbed. See specs/scenarios/http-agent-secret-references.feature.
 */

import { generate } from "@langwatch/ksuid";
import type { AuthConfig } from "@langwatch/scenario-contract";

/**
 * A secret reference, with flexible internal whitespace. The name follows the
 * same identifier grammar the engine and the secrets UI use.
 */
const SECRET_REFERENCE = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** The stand-in a resolved secret value is replaced by before it is shown. */
export const REDACTED_PLACEHOLDER = "[redacted]";

/**
 * A template with its secret references lifted out, and the substitution that
 * puts them back once the template has been rendered.
 */
export interface FencedTemplate {
  /** The template to render: every reference replaced by a placeholder. */
  template: string;
  /** Puts the resolved values back into the rendered output. */
  restore: (rendered: string) => string;
}

/** A stand-in that survives URL encoding while remaining unguessable. */
function placeholderFor({ nonce, index }: { nonce: string; index: number }): string {
  return `lw-secret-${nonce}-${index}`;
}

/**
 * Replaces every `{{ secrets.NAME }}` in `value` with the project's
 * secret. A name the project lacks is left verbatim — a missing secret is
 * a configuration error the author should see, not a silent blank.
 */
export function resolve({
  value,
  secrets,
}: {
  value: string;
  secrets: Record<string, string>;
}): string {
  if (value === "" || Object.keys(secrets).length === 0) return value;
  return value.replace(SECRET_REFERENCE, (match, name: string) => {
    const secret = secrets[name];
    return Object.hasOwn(secrets, name) && secret !== undefined ? secret : match;
  });
}

/**
 * Lifts secret references out of template for Liquid rendering, returns restore fn.
 * Avoids Liquid's `{% raw %}` (values unreachable if containing `{% endraw %}`),
 * keeping credential/scenario author boundary.
 */
export function fence({
  template,
  secrets,
}: {
  template: string;
  secrets: Record<string, string>;
}): FencedTemplate {
  if (template === "") return { template, restore: (rendered) => rendered };

  const values: string[] = [];
  const nonce = generate("scenario").toString();
  const fenced = template.replace(SECRET_REFERENCE, (match, name: string) => {
    const secret = secrets[name];
    const value = Object.hasOwn(secrets, name) && secret !== undefined ? secret : match;
    const index = values.push(value) - 1;
    return placeholderFor({ nonce, index });
  });

  if (values.length === 0) return { template, restore: (rendered) => rendered };

  return {
    template: fenced,
    restore: (rendered) =>
      values.reduce(
        (text, value, index) => text.split(placeholderFor({ nonce, index })).join(value),
        rendered,
      ),
  };
}

/**
 * Lifts secret references out of body template without resolving (engine doesn't
 * bind `secrets` either, so leaving refs alone renders them empty).
 */
export function preserve(template: string): FencedTemplate {
  return fence({ template, secrets: {} });
}

/**
 * Resolves references in the credential-bearing auth fields, on a copy —
 * `type` and the api-key header name are left alone, not secrets. The copy
 * matters: in-place substitution would bake a rotated-away value into every later turn.
 */
export function renderAuth({
  auth,
  secrets,
}: {
  auth: AuthConfig | undefined;
  secrets: Record<string, string>;
}): AuthConfig | undefined {
  if (!auth || Object.keys(secrets).length === 0) return auth;
  switch (auth.type) {
    case "bearer":
      return { ...auth, token: resolve({ value: auth.token, secrets }) };
    case "api_key":
      return { ...auth, value: resolve({ value: auth.value, secrets }) };
    case "basic":
      return {
        ...auth,
        username: resolve({ value: auth.username, secrets }),
        ...(auth.password !== undefined && {
          password: resolve({ value: auth.password, secrets }),
        }),
      };
    default:
      return auth;
  }
}

/**
 * Replaces resolved secret values in message with placeholder. Scrub before
 * errors escape. Longest value first (one secret can contain another).
 */
export function redact({
  message,
  secrets,
}: {
  message: string;
  secrets: Record<string, string>;
}): string {
  if (message === "") return message;
  const values = Object.values(secrets)
    .filter((value) => value !== "")
    .toSorted((a, b) => b.length - a.length);
  let redacted = message;
  for (const value of values) {
    redacted = redacted.split(value).join(REDACTED_PLACEHOLDER);
  }
  return redacted;
}

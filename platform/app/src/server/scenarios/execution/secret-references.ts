/**
 * `{{ secrets.NAME }}` references in an http target's request.
 *
 * A code target and a workflow target already read a project secret this way.
 * An http target gets the same reference in the places a credential actually
 * belongs, the url, the header values and the auth fields, so an API key
 * never has to be typed into the target's configuration, where anyone who can
 * open the target can read it back.
 *
 * The semantics mirror the engine's (services/nlpgo/app/engine/secrets.go):
 * substitution happens at request-build time so a rotated value is honored on
 * the next turn, a name the project does not have is left exactly as written,
 * and every resolved value is scrubbed out of anything the run shows back.
 *
 * @see specs/scenarios/http-agent-secret-references.feature
 */

import type { AuthConfig } from "../adapters/auth.strategies";

/**
 * A secret reference, with flexible internal whitespace. The name follows the
 * same identifier grammar the engine and the secrets UI use.
 */
const SECRET_REFERENCE = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** The stand-in a resolved secret value is replaced by before it is shown. */
export const REDACTED_PLACEHOLDER = "[redacted]";

/**
 * Replaces every `{{ secrets.NAME }}` in `value` with the project's secret.
 *
 * A reference to a name the project does not have is left verbatim: a missing
 * secret is a configuration error the author should see, not a silent blank
 * that masks the problem by sending an unauthenticated request upstream.
 */
export function resolveSecretRefs(
  value: string,
  secrets: Record<string, string>,
): string {
  if (value === "" || Object.keys(secrets).length === 0) return value;
  return value.replace(SECRET_REFERENCE, (match, name: string) =>
    Object.hasOwn(secrets, name) ? (secrets[name] as string) : match,
  );
}

/**
 * Resolves references in a string that a Liquid engine renders afterwards.
 *
 * Each reference becomes a `{% raw %}` block, whether or not the project has
 * the name. That is what makes both halves of the contract survive the render:
 * a resolved value reaches the wire byte for byte instead of being re-read as
 * template source, and an unresolved reference stays verbatim instead of being
 * rendered to an empty string by an engine that never binds `secrets`.
 */
export function resolveSecretRefsInTemplate(
  template: string,
  secrets: Record<string, string>,
): string {
  if (template === "") return template;
  return template.replace(SECRET_REFERENCE, (match, name: string) => {
    const value = Object.hasOwn(secrets, name) ? secrets[name] : match;
    return `{% raw %}${value}{% endraw %}`;
  });
}

/**
 * Fences off every secret reference in a template without resolving any.
 *
 * This is what "left untouched" has to mean for the body template. The body
 * carries the conversation and is authored by whoever writes the scenario, not
 * by whoever holds the credential, so no secret is ever substituted into it,
 * but the engine that renders it does not bind `secrets` either, so leaving
 * the reference alone would silently render it to an empty string. Fencing it
 * sends it on exactly as the author wrote it.
 */
export function preserveSecretRefs(template: string): string {
  return resolveSecretRefsInTemplate(template, {});
}

/**
 * Resolves references in every value of a record, leaving the keys alone:
 * a header name is not a credential.
 */
export function resolveSecretsInMap(
  values: Record<string, string>,
  secrets: Record<string, string>,
): Record<string, string> {
  if (Object.keys(secrets).length === 0) return values;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      resolveSecretRefs(value, secrets),
    ]),
  );
}

/**
 * Resolves references in the credential-bearing auth fields, on a copy.
 *
 * `type` and the api-key header *name* are left alone: they are not secrets.
 * The copy matters because the adapter's config outlives one turn, and
 * substituting in place would bake a rotated-away value into every turn after
 * the first.
 */
export function resolveAuthSecrets(
  auth: AuthConfig | undefined,
  secrets: Record<string, string>,
): AuthConfig | undefined {
  if (!auth || Object.keys(secrets).length === 0) return auth;
  switch (auth.type) {
    case "bearer":
      return { ...auth, token: resolveSecretRefs(auth.token, secrets) };
    case "api_key":
      return { ...auth, value: resolveSecretRefs(auth.value, secrets) };
    case "basic":
      return {
        ...auth,
        username: resolveSecretRefs(auth.username, secrets),
        ...(auth.password !== undefined && {
          password: resolveSecretRefs(auth.password, secrets),
        }),
      };
    default:
      return auth;
  }
}

/**
 * Replaces every resolved secret *value* in a message with the placeholder.
 *
 * The failure path is where a substituted credential escapes: a fetch error
 * commonly embeds the whole request url (query string included), and the
 * message the adapter throws becomes the run's recorded error, its span, and
 * its log line. Scrub before any of them see it.
 */
export function redactSecrets(
  message: string,
  secrets: Record<string, string>,
): string {
  if (message === "") return message;
  let redacted = message;
  for (const value of Object.values(secrets)) {
    if (value === "") continue;
    redacted = redacted.split(value).join(REDACTED_PLACEHOLDER);
  }
  return redacted;
}

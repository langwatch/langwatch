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

import { randomUUID } from "crypto";
import type { AuthConfig } from "@langwatch/scenario-contract";

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
function resolveSecretRefsValue({
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
 * A template with its secret references lifted out, and the substitution that
 * puts them back once the template has been rendered.
 */
export interface FencedTemplate {
  /** The template to render: every reference replaced by a placeholder. */
  template: string;
  /** Puts the resolved values back into the rendered output. */
  restore: (rendered: string) => string;
}

/**
 * Lifts every secret reference out of a template that a Liquid engine renders
 * afterwards, and hands back the substitution that restores them.
 *
 * A resolved value never reaches the template engine at all. Fencing it with
 * `{% raw %}` instead would put it there, and Liquid ends a raw block at the
 * first literal `{% endraw %}`, so a value carrying that text would close its
 * own fence and hand the rest of the template back to the engine as source.
 * Whoever writes a project secret is not always whoever writes the scenario,
 * so that is a boundary worth keeping.
 *
 * Both halves of the contract survive the round trip: a resolved value reaches
 * the wire byte for byte, and a reference to a name the project does not have
 * comes back exactly as written rather than being rendered to an empty string
 * by an engine that never binds `secrets`.
 */
function fenceSecretRefsValue({
  template,
  secrets,
}: {
  template: string;
  secrets: Record<string, string>;
}): FencedTemplate {
  if (template === "") return { template, restore: (rendered) => rendered };

  const values: string[] = [];
  // A nonce per call, so no authored template can spell a placeholder itself.
  const nonce = randomUUID();
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
 * The stand-in one reference is rendered as.
 *
 * Letters, digits and dashes only, so it survives both engines untouched: the
 * url engine encodes interpolated output rather than literal text, and a
 * placeholder is literal text. The nonce is what makes it unguessable, so no
 * authored template can spell one by accident.
 */
function placeholderFor({ nonce, index }: { nonce: string; index: number }): string {
  return `lw-secret-${nonce}-${index}`;
}

/**
 * Lifts every secret reference out of a template without resolving any.
 *
 * This is what "left untouched" has to mean for the body template. The body
 * carries the conversation and is authored by whoever writes the scenario, not
 * by whoever holds the credential, so no secret is ever substituted into it,
 * but the engine that renders it does not bind `secrets` either, so leaving
 * the reference alone would silently render it to an empty string. Lifting it
 * out and putting it back sends it on exactly as the author wrote it.
 */
function preserveSecretRefsValue(template: string): FencedTemplate {
  return fenceSecretRefsValue({ template, secrets: {} });
}

/**
 * Resolves references in the credential-bearing auth fields, on a copy.
 *
 * `type` and the api-key header *name* are left alone: they are not secrets.
 * The copy matters because the adapter's config outlives one turn, and
 * substituting in place would bake a rotated-away value into every turn after
 * the first.
 */
function resolveAuthSecretsValue({
  auth,
  secrets,
}: {
  auth: AuthConfig | undefined;
  secrets: Record<string, string>;
}): AuthConfig | undefined {
  if (!auth || Object.keys(secrets).length === 0) return auth;
  switch (auth.type) {
    case "bearer":
      return {
        ...auth,
        token: resolveSecretRefsValue({ value: auth.token, secrets }),
      };
    case "api_key":
      return {
        ...auth,
        value: resolveSecretRefsValue({ value: auth.value, secrets }),
      };
    case "basic":
      return {
        ...auth,
        username: resolveSecretRefsValue({ value: auth.username, secrets }),
        ...(auth.password !== undefined && {
          password: resolveSecretRefsValue({ value: auth.password, secrets }),
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
 *
 * Longest value first, because one secret can contain another: with `abc` and
 * `abcdef` in the project, replacing `abc` first leaves `[redacted]def` and
 * hands back the tail of the longer credential.
 */
function redactSecretsValue({
  message,
  secrets,
}: {
  message: string;
  secrets: Record<string, string>;
}): string {
  if (message === "") return message;
  const values = Object.values(secrets)
    .filter((value) => value !== "")
    .sort((a, b) => b.length - a.length);
  let redacted = message;
  for (const value of values) {
    redacted = redacted.split(value).join(REDACTED_PLACEHOLDER);
  }
  return redacted;
}

export class ScenarioSecretReferenceAdapter {
  static create(): ScenarioSecretReferenceAdapter {
    return new ScenarioSecretReferenceAdapter();
  }

  private constructor() {}

  static readonly resolve = resolveSecretRefsValue;
  static readonly fence = fenceSecretRefsValue;
  static readonly preserve = preserveSecretRefsValue;
  static readonly resolveAuth = resolveAuthSecretsValue;
  static readonly redact = redactSecretsValue;
}

export const resolveSecretRefs = ScenarioSecretReferenceAdapter.resolve;
export const fenceSecretRefs = ScenarioSecretReferenceAdapter.fence;
export const preserveSecretRefs = ScenarioSecretReferenceAdapter.preserve;
export const resolveAuthSecrets = ScenarioSecretReferenceAdapter.resolveAuth;
export const redactSecrets = ScenarioSecretReferenceAdapter.redact;

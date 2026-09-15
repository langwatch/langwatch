/**
 * `{{ secrets.NAME }}` references in http target requests: url, headers, auth fields.
 * Mirroring engine semantics: rotate-aware at request-build time, resolve-blind refs left
 * verbatim, all values scrubbed. See specs/scenarios/http-agent-secret-references.feature.
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
 * A template with its secret references lifted out, and the substitution that
 * puts them back once the template has been rendered.
 */
export interface FencedTemplate {
  /** The template to render: every reference replaced by a placeholder. */
  template: string;
  /** Puts the resolved values back into the rendered output. */
  restore: (rendered: string) => string;
}

export class ScenarioSecretReferenceAdapter {
  static create(): ScenarioSecretReferenceAdapter {
    return new ScenarioSecretReferenceAdapter();
  }

  private constructor() {}

  /**
   * The stand-in one reference is rendered as.
   *
   * Letters, digits and dashes only, so it survives both engines untouched: the
   * url engine encodes interpolated output rather than literal text, and a
   * placeholder is literal text. The nonce is what makes it unguessable, so no
   * authored template can spell one by accident.
   */
  private static placeholderFor({ nonce, index }: { nonce: string; index: number }): string {
    return `lw-secret-${nonce}-${index}`;
  }

  /**
   * Replaces every `{{ secrets.NAME }}` in `value` with the project's secret.
   *
   * A reference to a name the project does not have is left verbatim: a missing
   * secret is a configuration error the author should see, not a silent blank
   * that masks the problem by sending an unauthenticated request upstream.
   */
  static resolve({ value, secrets }: { value: string; secrets: Record<string, string> }): string {
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
  static fence({
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
      return ScenarioSecretReferenceAdapter.placeholderFor({ nonce, index });
    });

    if (values.length === 0) return { template, restore: (rendered) => rendered };

    return {
      template: fenced,
      restore: (rendered) =>
        values.reduce(
          (text, value, index) =>
            text.split(ScenarioSecretReferenceAdapter.placeholderFor({ nonce, index })).join(value),
          rendered,
        ),
    };
  }

  /**
   * Lifts secret references out of body template without resolving (engine doesn't
   * bind `secrets` either, so leaving refs alone renders them empty).
   */
  static preserve(template: string): FencedTemplate {
    return ScenarioSecretReferenceAdapter.fence({ template, secrets: {} });
  }

  /**
   * Resolves references in the credential-bearing auth fields, on a copy.
   *
   * `type` and the api-key header *name* are left alone: they are not secrets.
   * The copy matters because the adapter's config outlives one turn, and
   * substituting in place would bake a rotated-away value into every turn after
   * the first.
   */
  static resolveAuth({
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
          token: ScenarioSecretReferenceAdapter.resolve({ value: auth.token, secrets }),
        };
      case "api_key":
        return {
          ...auth,
          value: ScenarioSecretReferenceAdapter.resolve({ value: auth.value, secrets }),
        };
      case "basic":
        return {
          ...auth,
          username: ScenarioSecretReferenceAdapter.resolve({ value: auth.username, secrets }),
          ...(auth.password !== undefined && {
            password: ScenarioSecretReferenceAdapter.resolve({ value: auth.password, secrets }),
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
  static redact({
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
}

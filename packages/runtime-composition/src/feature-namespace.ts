import { FEATURE_NAMES } from "./feature-names.generated.ts";

export type FeatureName = (typeof FEATURE_NAMES)[number];

const NAMESPACE_EXCEPTIONS = {
  analytics: "analytics",
  auth: "auth",
  authz: "authz",
  billing: "billing",
  "data-privacy": "data-privacy",
  "data-retention": "data-retention",
  github: "github",
  governance: "governance",
  langy: "langy",
  licensing: "licensing",
  ops: "ops",
  presence: "presence",
  saas: "saas",
  scim: "scim",
  sso: "sso",
} as const satisfies Partial<Record<FeatureName, string>>;

type NamespaceExceptions = typeof NAMESPACE_EXCEPTIONS;

export type PublicNamespace<F extends FeatureName> = F extends keyof NamespaceExceptions
  ? NamespaceExceptions[F]
  : F extends `${infer Stem}y`
    ? F extends `${string}${"a" | "e" | "i" | "o" | "u"}y`
      ? `${F}s`
      : `${Stem}ies`
    : F extends `${string}${"s" | "x" | "z" | "ch" | "sh"}`
      ? `${F}es`
      : `${F}s`;

const FEATURE_NAME_SET = new Set<unknown>(FEATURE_NAMES);

export function publicNamespace<const F extends FeatureName>(feature: F): PublicNamespace<F>;
export function publicNamespace(feature: FeatureName): string {
  return publicNamespaceFromUnknown(feature);
}

/** Runtime boundary for names arriving from JSON or configuration. */
export function publicNamespaceFromUnknown(feature: unknown): string {
  if (!isFeatureName(feature)) {
    throw new Error(`Unknown feature name: ${feature}`);
  }

  const exception = Object.entries(NAMESPACE_EXCEPTIONS).find(([key]) => key === feature)?.[1];
  if (exception !== void 0) {
    return exception;
  }

  if (feature.endsWith("y")) {
    const preceding = feature.at(-2);
    if (preceding !== void 0 && "aeiou".includes(preceding)) {
      return `${feature}s`;
    }
    return `${feature.slice(0, -1)}ies`;
  }

  const sibilantEnding = ["s", "x", "z"].some((suffix) => feature.endsWith(suffix));
  if (sibilantEnding) {
    return `${feature}es`;
  }
  const digraphEnding = feature.endsWith("ch") || feature.endsWith("sh");
  if (digraphEnding) {
    return `${feature}es`;
  }
  return `${feature}s`;
}

function isFeatureName(feature: unknown): feature is FeatureName {
  return FEATURE_NAME_SET.has(feature);
}

export { NAMESPACE_EXCEPTIONS };
export { FEATURE_NAMES };

/**
 * Parse the raw `sdk.name` / `sdk.version` / `sdk.language` resource attributes
 * into a friendlier shape for display in the trace drawer.
 *
 * The chip in the header was just dumping `${name} ${version}` — useful for an
 * engineer who already knows what `langwatch-python` means, opaque for anyone
 * else. This helper detects the SDK family (LangWatch / OpenTelemetry /
 * OpenLLMetry) and the language so the UI can show "Python SDK · 0.5.13" with
 * a one-liner explaining what an SDK is and where it ran.
 */

export interface SdkInfo {
  rawName: string;
  rawVersion: string | null;
  /** Display name of the language ("Python", "TypeScript", "Go", …). */
  language: string;
  /** Family this SDK belongs to ("LangWatch", "OpenTelemetry", …) or null. */
  family: string | null;
  version: string | null;
  /** "Python · 0.5.13" — for the chip label. */
  shortLabel: string;
  /** "Python LangWatch SDK 0.5.13" — for the tooltip headline. */
  longLabel: string;
  /** One-liner explaining what this is to non-implementers. */
  description: string;
  /** Present when this trace was emitted while running under Scenario. */
  scenario: ScenarioSdkInfo | null;
}

/**
 * The Scenario SDK wraps a language SDK to drive simulated user/assistant
 * conversations. Until it emits its own `scenario.sdk.*` resource attributes,
 * we know it's active only via the trace-level scenarioRunId. Once the
 * downstream SDK starts setting `scenario.sdk.name` / `scenario.sdk.version`,
 * those flow through automatically.
 */
export interface ScenarioSdkInfo {
  /** Raw `scenario.sdk.name` value, if the SDK emitted one. */
  name: string | null;
  /** Raw `scenario.sdk.version` value, if the SDK emitted one. */
  version: string | null;
  /** Whether we know this trace came from a Scenario run (by scenarioRunId). */
  active: boolean;
}

export interface ParseSdkInputs {
  /** `sdk.name` resource attribute value. */
  name: unknown;
  /** `sdk.version` resource attribute value. */
  version: unknown;
  /** `sdk.language` resource attribute value. */
  language: unknown;
  /** `scenario.sdk.name` resource attribute, if present. */
  scenarioSdkName?: unknown;
  /** `scenario.sdk.version` resource attribute, if present. */
  scenarioSdkVersion?: unknown;
  /** Whether this trace belongs to a scenario run (`trace.scenarioRunId`). */
  scenarioActive?: boolean;
}

const LANGUAGE_RULES: ReadonlyArray<{ match: RegExp; label: string }> = [
  { match: /python/i, label: "Python" },
  { match: /typescript|^@?ts-|tsdk/i, label: "TypeScript" },
  { match: /node|nodejs|javascript|^@/i, label: "Node.js" },
  { match: /\bgo(lang)?\b/i, label: "Go" },
  { match: /\bruby\b/i, label: "Ruby" },
  { match: /\brust\b/i, label: "Rust" },
  { match: /\bjava\b/i, label: "Java" },
  { match: /dotnet|\.net|csharp|c#/i, label: "C#/.NET" },
  { match: /\bphp\b/i, label: "PHP" },
];

const FAMILY_RULES: ReadonlyArray<{ match: RegExp; label: string }> = [
  { match: /^langwatch/i, label: "LangWatch" },
  { match: /^@opentelemetry|^opentelemetry/i, label: "OpenTelemetry" },
  { match: /traceloop|openllmetry/i, label: "OpenLLMetry" },
];

const UNKNOWN_LANGUAGE = "Unknown language";

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function titleCase(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}

function detectLanguage(rawName: string, explicit: string | null): string {
  if (explicit) return titleCase(explicit);
  for (const { match, label } of LANGUAGE_RULES) {
    if (match.test(rawName)) return label;
  }
  return UNKNOWN_LANGUAGE;
}

function detectFamily(rawName: string): string | null {
  for (const { match, label } of FAMILY_RULES) {
    if (match.test(rawName)) return label;
  }
  return null;
}

export function parseSdkInfo(input: ParseSdkInputs): SdkInfo | null {
  const rawName = trimmedString(input.name);
  if (!rawName) return null;

  const rawVersion = trimmedString(input.version);
  const explicitLanguage = trimmedString(input.language);
  const language = detectLanguage(rawName, explicitLanguage);
  const family = detectFamily(rawName);

  const scenarioName = trimmedString(input.scenarioSdkName);
  const scenarioVersion = trimmedString(input.scenarioSdkVersion);
  const scenarioActive =
    !!input.scenarioActive || !!scenarioName || !!scenarioVersion;
  const scenario: ScenarioSdkInfo | null = scenarioActive
    ? { name: scenarioName, version: scenarioVersion, active: true }
    : null;

  const languagePart = rawVersion ? `${language} · ${rawVersion}` : language;
  const shortLabel = scenario
    ? scenario.version
      ? `Scenario ${scenario.version} · ${languagePart}`
      : `Scenario · ${languagePart}`
    : languagePart;

  const baseLong = family
    ? rawVersion
      ? `${language} ${family} SDK ${rawVersion}`
      : `${language} ${family} SDK`
    : rawVersion
      ? `${rawName} ${rawVersion}`
      : rawName;
  const longLabel = scenario
    ? scenario.version
      ? `Scenario SDK ${scenario.version} (on ${baseLong})`
      : `Scenario SDK (on ${baseLong})`
    : baseLong;

  const baseDescription = family
    ? `Captured by the ${language} ${family} SDK — the library installed in your service that emits traces.`
    : `Captured by the ${rawName} instrumentation library running in your service.`;
  const familySuffix = family ? ` ${family}` : "";
  const versionSuffix = rawVersion ? ` ${rawVersion}` : "";
  const description = scenario
    ? scenario.version
      ? `Emitted by Scenario SDK ${scenario.version} running on top of the ${language}${familySuffix} SDK${versionSuffix}. Scenario simulates user/assistant conversations to test your agent.`
      : `Emitted while running under the Scenario SDK on top of the ${language}${familySuffix} SDK${versionSuffix}. Scenario simulates user/assistant conversations to test your agent.`
    : baseDescription;

  return {
    rawName,
    rawVersion,
    language,
    family,
    version: rawVersion,
    shortLabel,
    longLabel,
    description,
    scenario,
  };
}

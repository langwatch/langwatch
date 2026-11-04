/**
 * What a project's Instant Evals run on, from the stored column value, the flag and the
 * provider row (ADR-182 decisions 4, 5 and 9).
 * @see specs/model-providers/instant-evals-decision-model.feature
 */

import {
  awsRegionOf,
  azureResourceOf,
  type DecisionEndpointParam,
  findDecisionModel,
  findModelProviderDefinition,
  INSTANT_EVAL_DECISION_FEATURE_KEY,
  isOwnDecisionModelId,
  type DecisionModelEntry,
  type DecisionModelResolution,
  type ModelDefaultScope,
} from "@langwatch/model-provider-contract";

/** The Default models keys that hold a decision model. */
export function isDecisionDefaultKey(key: string): boolean {
  return key === "INSTANT_EVALS" || key === INSTANT_EVAL_DECISION_FEATURE_KEY;
}

/** Whether a config about to be stored newly picks a decision model on an own key. */
export function picksOwnDecisionModel({
  config,
  stored = {},
}: {
  config: Readonly<Record<string, string>>;
  /** What the config held before; a value kept as it was is not a new pick. */
  stored?: Readonly<Record<string, string>>;
}): boolean {
  return Object.entries(config).some(
    ([key, model]) =>
      isDecisionDefaultKey(key) && isOwnDecisionModelId(model) && stored[key] !== model,
  );
}

/**
 * Each own decision model a config would store, with the scopes it must run from: every scope
 * for a new pick, only the scopes it gains for a value kept as it was.
 */
export function ownDecisionPicksToCheck({
  config,
  stored = {},
  scopes,
  storedScopes = [],
}: {
  config: Readonly<Record<string, string>>;
  stored?: Readonly<Record<string, string>>;
  scopes: readonly ModelDefaultScope[];
  storedScopes?: readonly ModelDefaultScope[];
}): { model: string; scopes: ModelDefaultScope[] }[] {
  const isStoredScope = (scope: ModelDefaultScope) =>
    storedScopes.some(
      (kept) => kept.scopeType === scope.scopeType && kept.scopeId === scope.scopeId,
    );
  return Object.entries(config)
    .filter(([key, model]) => isDecisionDefaultKey(key) && isOwnDecisionModelId(model))
    .map(([key, model]) => ({
      model,
      scopes: stored[key] === model ? scopes.filter((scope) => !isStoredScope(scope)) : [...scopes],
    }))
    .filter((pick) => pick.scopes.length > 0);
}

type DecisionProviderRow = Readonly<{
  enabled: boolean;
  customKeys: Readonly<Record<string, unknown>> | null;
}>;

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

type EndpointFill =
  | Readonly<{ kind: "filled"; endpoint: string }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "invalid" }>;

type EndpointValue = Readonly<{ kind: "value"; value: string }> | Readonly<{ kind: "invalid" }>;

/** One param's text, or `invalid` when the row's value cannot be part of the host. */
function endpointValueOf({
  param,
  raw,
}: {
  param: DecisionEndpointParam;
  raw: string;
}): EndpointValue {
  if (param.read === "value") return { kind: "value", value: encodeURIComponent(raw) };
  if (param.read === "aws_region") {
    const aws = awsRegionOf(raw);
    return aws.kind === "aws" ? { kind: "value", value: aws.region } : { kind: "invalid" };
  }
  const azure = azureResourceOf(raw);
  return azure.kind === "azure" ? { kind: "value", value: azure.resource } : { kind: "invalid" };
}

/** Fills each `{name}` from the row; Azure and AWS fields name only their vendor's host. */
function fillEndpoint({
  entry,
  customKeys,
}: {
  entry: DecisionModelEntry & { endpoint: string };
  customKeys: DecisionProviderRow["customKeys"];
}): EndpointFill {
  let endpoint = entry.endpoint;
  for (const [name, param] of Object.entries(entry.endpointParams ?? {})) {
    const raw = normalizeText(customKeys?.[param.field]);
    if (!raw) return { kind: "missing" };
    const filled = endpointValueOf({ param, raw });
    if (filled.kind === "invalid") return { kind: "invalid" };
    endpoint = endpoint.replace(`{${name}}`, filled.value);
  }
  return { kind: "filled", endpoint };
}

/** The flag is the caller's to ask; this answers for an organization that has it. */
export function decisionModelResolutionOf({
  model,
  row,
}: {
  /** The stored column value; undefined when nothing is stored. */
  model: string | undefined;
  /** The project's row for the model's provider; undefined when there is none. */
  row: DecisionProviderRow | undefined;
}): DecisionModelResolution {
  const entry = model === undefined ? undefined : findDecisionModel(model);
  if (!entry?.wire || !entry.providerModel || !entry.endpoint) return { kind: "langwatch" };
  if (!row) return { kind: "own_unavailable", model: entry.id, reason: "provider_missing" };
  if (!row.enabled)
    return { kind: "own_unavailable", model: entry.id, reason: "provider_disabled" };

  const keyField = entry.keyField ?? findModelProviderDefinition(entry.provider)?.apiKey;
  const apiKey = keyField ? normalizeText(row.customKeys?.[keyField]) : undefined;
  const filled = fillEndpoint({
    entry: { ...entry, endpoint: entry.endpoint },
    customKeys: row.customKeys,
  });
  if (!apiKey || filled.kind === "missing") {
    return { kind: "own_unavailable", model: entry.id, reason: "key_missing" };
  }
  if (filled.kind !== "filled") {
    return { kind: "own_unavailable", model: entry.id, reason: "endpoint_invalid" };
  }

  const deployment = entry.providerModelField
    ? normalizeText(row.customKeys?.[entry.providerModelField])
    : undefined;
  return {
    kind: "own",
    model: entry.id,
    wire: entry.wire,
    providerModel: deployment ?? entry.providerModel,
    endpoint: filled.endpoint,
    authHeader: entry.authHeader ?? "bearer",
    apiKey,
  };
}

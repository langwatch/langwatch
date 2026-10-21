import { z } from "zod";

import { otlpKeyValueSchema, type OtlpKeyValue } from "./any-value.ts";

const API_KEY_ATTRIBUTE = "langwatch.api_key.id";
const SIGNAL_KEYS = {
  traces: { resources: "resourceSpans", scopes: "scopeSpans" },
  logs: { resources: "resourceLogs", scopes: "scopeLogs" },
  metrics: { resources: "resourceMetrics", scopes: "scopeMetrics" },
} as const;
type Signal = keyof typeof SIGNAL_KEYS;

export const otlpReceiverPolicySchema = z.object({
  resourceAttributeKeysToRemove: z.array(z.string()),
  resourceAttributes: z.array(otlpKeyValueSchema),
  allowedTraceScopeNames: z.array(z.string()).optional(),
  allowedMetricScopeNames: z.array(z.string()).optional(),
});
export type OtlpReceiverPolicy = z.infer<typeof otlpReceiverPolicySchema>;

interface AttributeHolder {
  attributes?: OtlpKeyValue[] | null;
}

interface ReceiverSpan extends AttributeHolder {
  events?: (AttributeHolder | null)[] | null;
  links?: (AttributeHolder | null)[] | null;
}

interface ReceiverMetricDataPoint extends AttributeHolder {
  exemplars?: ({ filteredAttributes?: OtlpKeyValue[] | null } | null)[] | null;
}

interface ReceiverMetricSeries {
  dataPoints?: (ReceiverMetricDataPoint | null)[] | null;
}

interface ReceiverMetric extends AttributeHolder {
  gauge?: ReceiverMetricSeries | null;
  sum?: ReceiverMetricSeries | null;
  histogram?: ReceiverMetricSeries | null;
  exponentialHistogram?: ReceiverMetricSeries | null;
  summary?: ReceiverMetricSeries | null;
}

interface ReceiverScopeGroup {
  scope?: (AttributeHolder & { name?: string | null }) | null;
  spans?: (ReceiverSpan | null)[] | null;
  logRecords?: (AttributeHolder | null)[] | null;
  metrics?: (ReceiverMetric | null)[] | null;
}

interface ReceiverResourceGroup {
  resource?: AttributeHolder | null;
  scopeSpans?: (ReceiverScopeGroup | null)[] | null;
  scopeLogs?: (ReceiverScopeGroup | null)[] | null;
  scopeMetrics?: (ReceiverScopeGroup | null)[] | null;
}

/** What a scope allowlist refused: the scopes, and the spans or data points they carried. */
export interface OtlpScopeDrop {
  droppedScopes: number;
  droppedItems: number;
  droppedScopeNames: string[];
}

/** Mutation view of an already parsed export; unrelated wire fields stay untouched. */
export interface OtlpReceiverRequest {
  resourceSpans?: (ReceiverResourceGroup | null)[] | null;
  resourceLogs?: (ReceiverResourceGroup | null)[] | null;
  resourceMetrics?: (ReceiverResourceGroup | null)[] | null;
}

export function applyOtlpReceiverPolicy({
  request,
  signal,
  apiKeyId,
  policy,
}: {
  request: OtlpReceiverRequest;
  signal: Signal;
  apiKeyId: string | null;
  policy?: OtlpReceiverPolicy;
}): OtlpScopeDrop {
  const keys = SIGNAL_KEYS[signal];
  const resources = request[keys.resources] ?? [];
  const scopeNames = {
    traces: policy?.allowedTraceScopeNames,
    logs: void 0,
    metrics: policy?.allowedMetricScopeNames,
  }[signal];
  const allowed = scopeNames ? new Set(scopeNames) : void 0;
  const drop: OtlpScopeDrop = { droppedScopes: 0, droppedItems: 0, droppedScopeNames: [] };

  for (let index = resources.length - 1; index >= 0; index -= 1) {
    const group = resources[index];
    if (!group) {
      continue;
    }

    applyResourceAttributes(group, apiKeyId, policy);
    const scopes = group[keys.scopes] ?? [];
    protectScopes({ scopes, signal, allowed, drop });

    if (allowed && scopes.length === 0) {
      resources.splice(index, 1);
    }
  }

  return drop;
}

function applyResourceAttributes(
  group: ReceiverResourceGroup,
  apiKeyId: string | null,
  policy: OtlpReceiverPolicy | undefined,
): void {
  const resource = group.resource ?? { attributes: [] };
  const attributes = resource.attributes ?? [];
  group.resource = resource;
  resource.attributes = attributes;
  const remove = new Set(policy?.resourceAttributeKeysToRemove ?? []);

  for (let index = attributes.length - 1; index >= 0; index -= 1) {
    const attribute = attributes[index];
    if (attribute && remove.has(attribute.key)) {
      attributes.splice(index, 1);
    }
  }

  attributes.push(...(policy?.resourceAttributes ?? []));
  // Policy cannot replace or erase authenticated identity: stamp it last.
  scrubKeyAttributes(attributes);

  if (apiKeyId !== null) {
    attributes.push({ key: API_KEY_ATTRIBUTE, value: { stringValue: apiKeyId } });
  }
}

function protectScopes({
  scopes,
  signal,
  allowed,
  drop,
}: {
  scopes: (ReceiverScopeGroup | null)[];
  signal: Signal;
  allowed: Set<string> | undefined;
  drop: OtlpScopeDrop;
}): void {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const scope = scopes[index];
    const name = scope?.scope?.name ?? "";
    if (allowed && !allowed.has(name)) {
      scopes.splice(index, 1);
      drop.droppedScopes += 1;
      drop.droppedItems += scope ? countScopeItems(scope, signal) : 0;
      if (!drop.droppedScopeNames.includes(name)) drop.droppedScopeNames.push(name);
      continue;
    }

    if (scope) {
      scrubKeyAttributes(scope.scope?.attributes);
      scrubScopeContents(scope, signal);
    }
  }
}

/** The items OTLP's partial success counts for a signal: spans, log records or data points. */
function countScopeItems(scope: ReceiverScopeGroup, signal: Signal): number {
  switch (signal) {
    case "traces":
      return scope.spans?.length ?? 0;
    case "logs":
      return scope.logRecords?.length ?? 0;
    case "metrics":
      return (scope.metrics ?? []).reduce(
        (total, metric) =>
          total +
          [
            metric?.gauge,
            metric?.sum,
            metric?.histogram,
            metric?.exponentialHistogram,
            metric?.summary,
          ].reduce((points, series) => points + (series?.dataPoints?.length ?? 0), 0),
        0,
      );
  }
}

function scrubScopeContents(scope: ReceiverScopeGroup, signal: Signal): void {
  switch (signal) {
    case "traces":
      for (const span of scope.spans ?? []) {
        scrubSpan(span);
      }
      break;
    case "logs":
      for (const record of scope.logRecords ?? []) {
        scrubKeyAttributes(record?.attributes);
      }
      break;
    case "metrics":
      for (const metric of scope.metrics ?? []) {
        scrubMetric(metric);
      }
      break;
  }
}

function scrubSpan(span: ReceiverSpan | null): void {
  scrubKeyAttributes(span?.attributes);

  for (const event of span?.events ?? []) {
    scrubKeyAttributes(event?.attributes);
  }

  for (const link of span?.links ?? []) {
    scrubKeyAttributes(link?.attributes);
  }
}

function scrubMetric(metric: ReceiverMetric | null): void {
  scrubKeyAttributes(metric?.attributes);
  const series = [
    metric?.gauge,
    metric?.sum,
    metric?.histogram,
    metric?.exponentialHistogram,
    metric?.summary,
  ];

  for (const data of series) {
    for (const point of data?.dataPoints ?? []) {
      scrubKeyAttributes(point?.attributes);

      for (const exemplar of point?.exemplars ?? []) {
        scrubKeyAttributes(exemplar?.filteredAttributes);
      }
    }
  }
}

function scrubKeyAttributes(attributes: OtlpKeyValue[] | null | undefined): void {
  if (!attributes) {
    return;
  }

  for (let index = attributes.length - 1; index >= 0; index -= 1) {
    if (attributes[index]?.key === API_KEY_ATTRIBUTE) {
      attributes.splice(index, 1);
    }
  }
}

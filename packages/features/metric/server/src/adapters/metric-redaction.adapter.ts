import { isRecord, type UnknownRecord } from "./metric-serialization.rules";

import type { MetricPiiRedactionLevel } from "@langwatch/metric-contract";
import type { MetricRedactionPort } from "../ports/metric-redaction.port";

type StringRef = {
  owner: UnknownRecord;
  key: string;
  syntheticKey: string;
  /** The OTLP attribute this string belongs to, when it sits under one. */
  attributeName?: string;
};

/** The attribute an OTLP KeyValue node names, when this node is one. */
function otlpAttributeName(value: UnknownRecord): string | undefined {
  return typeof value.key === "string" && "value" in value ? value.key : undefined;
}

/**
 * `syntheticKey` addresses the leaf and is built from array indices, so it can
 * never satisfy a sensitive-NAME rule: a point attribute list yields
 * `point.0.value.stringValue`. The owning attribute's real name travels with it
 * so those rules can run on this pipeline at all.
 */
function collectStringRefs({
  value,
  prefix,
  out,
  attributeName,
}: {
  value: unknown;
  prefix: string;
  out: StringRef[];
  attributeName?: string;
}): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectStringRefs({
        value: item,
        prefix: `${prefix}.${index}`,
        out,
        attributeName,
      }),
    );
    return;
  }
  if (!isRecord(value)) return;
  const ownName = otlpAttributeName(value) ?? attributeName;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === "stringValue" && typeof child === "string") {
      out.push({ owner: value, key, syntheticKey: path, attributeName });
    } else {
      collectStringRefs({
        value: child,
        prefix: path,
        out,
        attributeName: ownName,
      });
    }
  }
}

/** Redacts every nested AnyValue string without flattening its stored type. */
async function redactTypedAttributes(args: {
  resourceAttributes: unknown;
  scopeAttributes: unknown;
  pointAttributes: unknown;
  exemplarAttributes: unknown;
  redactionService: MetricRedactionPort;
  piiRedactionLevel: MetricPiiRedactionLevel;
  tenantId: string;
}): Promise<void> {
  const refs: StringRef[] = [];
  collectStringRefs({
    value: args.resourceAttributes,
    prefix: "resource",
    out: refs,
  });
  collectStringRefs({
    value: args.scopeAttributes,
    prefix: "scope",
    out: refs,
  });
  collectStringRefs({
    value: args.pointAttributes,
    prefix: "point",
    out: refs,
  });
  collectStringRefs({
    value: args.exemplarAttributes,
    prefix: "exemplar",
    out: refs,
  });
  const attributes: Record<string, string> = Object.fromEntries(
    refs.map((ref): [string, string] => {
      const value = ref.owner[ref.key];
      return [ref.syntheticKey, typeof value === "string" ? value : String(value)];
    }),
  );
  const attributeNames = Object.fromEntries(
    refs.flatMap((ref) =>
      ref.attributeName === undefined ? [] : [[ref.syntheticKey, ref.attributeName]],
    ),
  );
  await args.redactionService.redactMetricAttributes(
    { attributes, resourceAttributes: {}, attributeNames },
    args.piiRedactionLevel,
    args.tenantId,
  );
  for (const ref of refs) {
    const redacted = attributes[ref.syntheticKey];
    if (redacted !== undefined) ref.owner[ref.key] = redacted;
  }
}

export { redactTypedAttributes };

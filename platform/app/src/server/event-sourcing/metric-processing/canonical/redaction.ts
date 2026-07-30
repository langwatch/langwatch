import { isRecord, type UnknownRecord } from "./serialization";

export type PiiRedactionLevel = "STRICT" | "ESSENTIAL" | "DISABLED";

/** The redaction port this pipeline needs — narrowed to exactly one method. */
export interface RedactionService {
  redactMetricAttributes(
    metric: {
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PiiRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
}

interface StringRef {
  owner: UnknownRecord;
  key: string;
  syntheticKey: string;
}

function collectStringRefs(args: {
  value: unknown;
  prefix: string;
  out: StringRef[];
}): void {
  const { value, prefix, out } = args;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectStringRefs({ value: item, prefix: `${prefix}.${index}`, out }),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === "stringValue" && typeof child === "string") {
      out.push({ owner: value, key, syntheticKey: path });
    } else {
      collectStringRefs({ value: child, prefix: path, out });
    }
  }
}

/**
 * Redacts every nested `AnyValue` string in place, without flattening the
 * tagged shape it lives in — the caller mutates `owner[key]` directly, so a
 * `{ type: "string", value: "secret" }` node stays a typed node after
 * redaction, and every sibling node (ints, bools, doubles — including `0`)
 * is left completely untouched.
 */
export async function redactTypedAttributes(args: {
  resourceAttributes: unknown;
  scopeAttributes: unknown;
  pointAttributes: unknown;
  exemplarAttributes: unknown;
  redactionService: RedactionService;
  piiRedactionLevel: PiiRedactionLevel;
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

  const attributes = Object.fromEntries(
    refs.map((ref) => [ref.syntheticKey, ref.owner[ref.key] as string]),
  );
  await args.redactionService.redactMetricAttributes(
    { attributes, resourceAttributes: {} },
    args.piiRedactionLevel,
    args.tenantId,
  );
  for (const ref of refs) {
    const redacted = attributes[ref.syntheticKey];
    if (redacted !== undefined) ref.owner[ref.key] = redacted;
  }
}

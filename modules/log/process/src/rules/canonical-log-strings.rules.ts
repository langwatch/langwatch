import { isRecord, type UnknownRecord } from "./canonical-log-value.rules.ts";

export type StringRef = {
  owner: UnknownRecord;
  key: string;
  path: string;
  /** The OTLP attribute this string belongs to, when it sits under one. */
  attributeName?: string;
};

export function collectStringRefs({
  value,
  prefix,
  refs,
  attributeName,
}: {
  value: unknown;
  prefix: string;
  refs: StringRef[];
  attributeName?: string;
}): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      collectStringRefs({
        value: child,
        prefix: `${prefix}.${index}`,
        refs,
        attributeName,
      }),
    );
    return;
  }
  if (!isRecord(value)) return;
  const ownName = typeof value.key === "string" && "value" in value ? value.key : attributeName;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === "stringValue" && typeof child === "string") {
      refs.push({ owner: value, key, path, attributeName });
    } else {
      collectStringRefs({
        value: child,
        prefix: path,
        refs,
        attributeName: ownName,
      });
    }
  }
}

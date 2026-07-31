import type { PIIRedactionLevel } from "./schema";
import { isRecord, type UnknownRecord } from "./serialization";

export interface LogRedactionService {
  redactLog(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
    },
    piiRedactionLevel: PIIRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
}

type StringRef = { owner: UnknownRecord; key: string; path: string };

function collectStringRefs(
  value: unknown,
  prefix: string,
  refs: StringRef[],
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      collectStringRefs(child, `${prefix}.${index}`, refs),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === "stringValue" && typeof child === "string") {
      refs.push({ owner: value, key, path });
    } else {
      collectStringRefs(child, path, refs);
    }
  }
}

/**
 * Redacts every nested `stringValue` in the raw wire node *before*
 * canonicalization sees it, so a redacted record's `recordId` hashes the
 * redacted content — a leak that survived only in the hash is still a leak.
 */
export async function redactTypedLog(args: {
  resourceAttributes: unknown;
  scopeAttributes: unknown;
  logAttributes: unknown;
  body: unknown;
  redactionService: LogRedactionService;
  piiRedactionLevel: PIIRedactionLevel;
  tenantId: string;
}): Promise<void> {
  const refs: StringRef[] = [];
  collectStringRefs(args.resourceAttributes, "resource", refs);
  collectStringRefs(args.scopeAttributes, "scope", refs);
  collectStringRefs(args.logAttributes, "log", refs);
  collectStringRefs(args.body, "body", refs);
  const attributes = Object.fromEntries(
    refs.map((ref) => [ref.path, String(ref.owner[ref.key])]),
  );
  await args.redactionService.redactLog(
    { body: "", attributes, resourceAttributes: {} },
    args.piiRedactionLevel,
    args.tenantId,
  );
  for (const ref of refs) {
    const redacted = attributes[ref.path];
    if (redacted !== undefined) ref.owner[ref.key] = redacted;
  }
}

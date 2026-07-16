import type { SavedTriggerRow, SummaryIdentity } from "../../types";
import {
  validateWebhookUrlShape,
  WEBHOOK_HEADER_VALUE_KEPT,
  WEBHOOK_METHODS,
  type WebhookActionParams,
  type WebhookMethod,
} from "./shared";

/** A template field, mirroring the Slack provider's `FieldDraft`: empty +
 *  `usingDefault` means the framework default envelope applies. */
export interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

export interface HeaderRow {
  /** Stable client-side identity for React keys — rows are added/removed. */
  id: string;
  name: string;
  value: string;
  /** True when the value is a saved secret the server kept back (ADR-040 §3):
   *  the input shows a masked placeholder, and the save sends the kept
   *  sentinel so the stored value survives. Typing or renaming clears it. */
  kept: boolean;
}

let headerRowSeq = 0;
export function newHeaderRow(partial?: Partial<Omit<HeaderRow, "id">>): HeaderRow {
  headerRowSeq += 1;
  return {
    id: `hdr_${headerRowSeq}`,
    name: "",
    value: "",
    kept: false,
    ...partial,
  };
}

export interface WebhookSlice {
  url: string;
  method: WebhookMethod;
  headers: HeaderRow[];
  template: FieldDraft;
}

export const EMPTY_FIELD: FieldDraft = { value: "", usingDefault: true };

export function initialSlice(): WebhookSlice {
  return { url: "", method: "POST", headers: [], template: EMPTY_FIELD };
}

export function isComplete(slice: WebhookSlice): boolean {
  return validateWebhookUrlShape(slice.url.trim()) === null;
}

export function summary(slice: WebhookSlice, identity: SummaryIdentity): string {
  const name = identity.name || "(unnamed)";
  const host = (() => {
    try {
      return new URL(slice.url).hostname;
    } catch {
      return null;
    }
  })();
  return `${name} → ${slice.method} ${host ?? "(URL not set)"}`;
}

export function fromTriggerRow(row: SavedTriggerRow): WebhookSlice {
  const params = (row.actionParams ?? {}) as Partial<WebhookActionParams>;
  // Saved header VALUES never reach the client (ADR-040 §3) — the server
  // echoes names with the kept sentinel, which renders as a masked row.
  const headers = Object.entries(params.headers ?? {}).map(([name, value]) =>
    value === WEBHOOK_HEADER_VALUE_KEPT
      ? newHeaderRow({ name, kept: true })
      : newHeaderRow({ name, value }),
  );
  return {
    url: typeof params.url === "string" ? params.url : "",
    method: WEBHOOK_METHODS.includes(params.method as WebhookMethod)
      ? (params.method as WebhookMethod)
      : "POST",
    headers,
    template: {
      value: params.bodyTemplate ?? "",
      usingDefault: params.bodyTemplate == null,
    },
  };
}

function headersRecord(rows: HeaderRow[]): Record<string, string> {
  // Prototype-free map: a user-entered `__proto__` header must land as an own
  // property, not mutate Object.prototype (which would silently drop it).
  const out = Object.create(null) as Record<string, string>;
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    // A kept row sends the sentinel; the server resolves it against the
    // stored ciphertext (save) or drops it if unresolvable (test fire).
    out[name] = row.kept ? WEBHOOK_HEADER_VALUE_KEPT : row.value;
  }
  return out;
}

function bodyTemplateOf(slice: WebhookSlice): string | null {
  return slice.template.value.trim().length > 0 ? slice.template.value : null;
}

export function toActionParams(slice: WebhookSlice): WebhookActionParams {
  return {
    url: slice.url.trim(),
    method: slice.method,
    headers: headersRecord(slice.headers),
    bodyTemplate: bodyTemplateOf(slice),
  };
}

export function testFireTarget(slice: WebhookSlice) {
  return {
    webhook: null,
    webhookDestination: {
      url: slice.url.trim(),
      method: slice.method,
      headers: headersRecord(slice.headers),
      bodyTemplate: bodyTemplateOf(slice),
    },
  };
}

/** The webhook's body lives inside `actionParams` (ADR-040 §1), not in the
 *  four legacy Trigger template columns — so this contributes nothing. */
export function templatesFromSlice(_slice: WebhookSlice) {
  return {
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    slackTemplate: null,
    slackTemplateType: null,
  };
}

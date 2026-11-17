// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The OCSF SIEM routes: the three export streams, the push-in route and the pushed event type.
 * Spec: enterprise/modules/governance/specs/ocsf-siem.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The OCSF schema version every event LangWatch builds is written against. */
export const OCSF_EXPORT_SCHEMA_VERSION = "1.9.0" as const;
/** The webhook event type an endpoint subscribes to for pushed OCSF events; `data` is one event. */
export const OCSF_EVENT_TYPE = "ocsf.event" as const;
/** The `SourceType` events pushed in from another source are stored under. */
export const OCSF_PUSHED_SOURCE_TYPE = "ocsf_push" as const;
export const OCSF_EXPORT_PAGE_LIMIT_MAX = 1000;
export const OCSF_INGEST_BATCH_MAX = 500;
/** One pushed-in event's serialised size limit, the same 64 KiB the activity table keeps. */
export const OCSF_INGEST_EVENT_MAX_BYTES = 64 * 1024;

/** The cursor each stream answers: base64url JSON, opaque to the caller. */
export function encodeOcsfCursor(value: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursorJson(cursor: string): unknown {
  const binary = atob(cursor.replaceAll("-", "+").replaceAll("_", "/"));
  return JSON.parse(
    new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))),
  );
}

const governanceCursorSchema = z.object({ t: z.number().int().nonnegative(), e: z.string() });
const tracesCursorSchema = z.object({
  p: z.string().nullable(),
  s: z.string().nullable(),
  f: z.number().int().nonnegative(),
  t: z.number().int().nonnegative().nullable(),
});
const auditCursorSchema = z.object({ t: z.number().int().nonnegative(), i: z.string() });

export type OcsfGovernanceCursor = z.infer<typeof governanceCursorSchema>;
export type OcsfTracesCursor = z.infer<typeof tracesCursorSchema>;
export type OcsfAuditCursor = z.infer<typeof auditCursorSchema>;

function decodeWith<T>(schema: z.ZodType<T>, cursor: string): T | undefined {
  try {
    const parsed = schema.safeParse(decodeCursorJson(cursor));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export const decodeOcsfGovernanceCursor = (cursor: string): OcsfGovernanceCursor | undefined =>
  decodeWith(governanceCursorSchema, cursor);
export const decodeOcsfTracesCursor = (cursor: string): OcsfTracesCursor | undefined =>
  decodeWith(tracesCursorSchema, cursor);
export const decodeOcsfAuditCursor = (cursor: string): OcsfAuditCursor | undefined =>
  decodeWith(auditCursorSchema, cursor);

function cursorField(decode: (cursor: string) => unknown) {
  return z
    .string()
    .min(1)
    .max(4096)
    .refine((cursor) => decode(cursor) !== undefined, {
      message: "Not a cursor this route issued; pass back next_cursor unchanged",
    })
    .optional();
}

const windowFields = {
  limit: z.coerce.number().int().min(1).max(OCSF_EXPORT_PAGE_LIMIT_MAX).default(500),
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
};

const ocsfEventsQuerySchemaDefinition = z.object({
  ...windowFields,
  cursor: cursorField(decodeOcsfGovernanceCursor),
  source_type: z.string().min(1).max(128).optional(),
  source_id: z.string().min(1).max(256).optional(),
});
export interface OcsfEventsQuerySchema extends Named<typeof ocsfEventsQuerySchemaDefinition> {}
export const ocsfEventsQuerySchema: OcsfEventsQuerySchema = ocsfEventsQuerySchemaDefinition;
export type OcsfEventsQuery = z.infer<typeof ocsfEventsQuerySchema>;

const ocsfTracesQuerySchemaDefinition = z.object({
  ...windowFields,
  cursor: cursorField(decodeOcsfTracesCursor),
  project_id: z.string().min(1).max(128).optional(),
});
export interface OcsfTracesQuerySchema extends Named<typeof ocsfTracesQuerySchemaDefinition> {}
export const ocsfTracesQuerySchema: OcsfTracesQuerySchema = ocsfTracesQuerySchemaDefinition;
export type OcsfTracesQuery = z.infer<typeof ocsfTracesQuerySchema>;

const ocsfAuditQuerySchemaDefinition = z.object({
  ...windowFields,
  cursor: cursorField(decodeOcsfAuditCursor),
});
export interface OcsfAuditQuerySchema extends Named<typeof ocsfAuditQuerySchemaDefinition> {}
export const ocsfAuditQuerySchema: OcsfAuditQuerySchema = ocsfAuditQuerySchemaDefinition;
export type OcsfAuditQuery = z.infer<typeof ocsfAuditQuerySchema>;

/** One OCSF event as JSON; the routes document its shape in prose rather than re-declare OCSF. */
const ocsfEventSchemaDefinition = z.record(z.string(), z.unknown());
export interface OcsfEventSchema extends Named<typeof ocsfEventSchemaDefinition> {}
export const ocsfEventSchema: OcsfEventSchema = ocsfEventSchemaDefinition;
export type OcsfEvent = z.infer<typeof ocsfEventSchema>;

const ocsfEventsPageSchemaDefinition = z.object({
  ocsf_version: z.string(),
  data: ocsfEventSchema.array(),
  /** Always set: pass it back as `cursor` to read on from this page. */
  next_cursor: z.string(),
  /** True when more events are already waiting after this page. */
  has_more: z.boolean(),
});
export interface OcsfEventsPageSchema extends Named<typeof ocsfEventsPageSchemaDefinition> {}
export const ocsfEventsPageSchema: OcsfEventsPageSchema = ocsfEventsPageSchemaDefinition;
export type OcsfEventsPage = z.infer<typeof ocsfEventsPageSchema>;

const YEAR_2000_MS = 946_684_800_000;
/** How far ahead of now a pushed-in event's `time` may be. */
export const OCSF_INGEST_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

/** OCSF class ids are six digits (category * 1000 + class); type_uid is class_uid * 100 + activity. */
export const OCSF_CLASS_UID_MAX = 999_999;
export const OCSF_CATEGORY_UID_MAX = 999;
export const OCSF_TYPE_UID_MAX = OCSF_CLASS_UID_MAX * 100 + 99;

/** The size limit is in bytes on the wire, so multibyte text counts as it is sent. */
function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

const ocsfIngestEventSchemaDefinition = z
  .looseObject({
    class_uid: z.number().int().min(0).max(OCSF_CLASS_UID_MAX),
    category_uid: z.number().int().min(0).max(OCSF_CATEGORY_UID_MAX).optional(),
    activity_id: z.number().int().min(0).max(255).optional(),
    type_uid: z.number().int().min(0).max(OCSF_TYPE_UID_MAX).optional(),
    severity_id: z.number().int().min(0).max(255),
    /** Epoch milliseconds; the route also refuses a time more than a day ahead. */
    time: z.number().int().min(YEAR_2000_MS),
    metadata: z.looseObject({
      uid: z.string().min(1).max(256),
      version: z.string().min(1).max(32),
    }),
  })
  .refine((event) => utf8ByteLength(JSON.stringify(event)) <= OCSF_INGEST_EVENT_MAX_BYTES, {
    message: `An event is at most ${OCSF_INGEST_EVENT_MAX_BYTES} bytes as JSON`,
  });
export interface OcsfIngestEventSchema extends Named<typeof ocsfIngestEventSchemaDefinition> {}
export const ocsfIngestEventSchema: OcsfIngestEventSchema = ocsfIngestEventSchemaDefinition;
export type OcsfIngestEvent = z.infer<typeof ocsfIngestEventSchema>;

const ocsfIngestRequestSchemaDefinition = z.object({
  /** Names the sending tool; an event's identity is (source, metadata.uid). */
  source: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_.-]{0,62}$/, "lowercase letters, digits, '.', '_' or '-'"),
  events: ocsfIngestEventSchema.array().min(1).max(OCSF_INGEST_BATCH_MAX),
});
export interface OcsfIngestRequestSchema extends Named<typeof ocsfIngestRequestSchemaDefinition> {}
export const ocsfIngestRequestSchema: OcsfIngestRequestSchema = ocsfIngestRequestSchemaDefinition;
export type OcsfIngestRequest = z.infer<typeof ocsfIngestRequestSchema>;

const ocsfIngestResponseSchemaDefinition = z.object({
  /** Distinct events stored; a uid repeated within the batch counts once. */
  accepted: z.number().int().nonnegative(),
});
export interface OcsfIngestResponseSchema extends Named<
  typeof ocsfIngestResponseSchemaDefinition
> {}
export const ocsfIngestResponseSchema: OcsfIngestResponseSchema =
  ocsfIngestResponseSchemaDefinition;
export type OcsfIngestResponse = z.infer<typeof ocsfIngestResponseSchema>;

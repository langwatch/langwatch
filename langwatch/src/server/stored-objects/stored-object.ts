/**
 * StoredObject — Zod schema and inferred type for a row in the stored_objects
 * ClickHouse table.
 *
 * All fields mirror the table DDL in
 * src/server/clickhouse/migrations/00023_create_stored_objects.sql.
 */
import { z } from "zod";

export const storedObjectSchema = z.object({
  /** Deterministic UUID v5 derived from (project_id, sha256). */
  id: z.string(),
  /** Project that owns this object. Used as the first ORDER BY key. */
  project_id: z.string(),
  /** Human-readable classification (e.g. "trace_content", "scenario_attachment"). */
  purpose: z.string(),
  /** Type of entity that produced this object (e.g. "span", "scenario_event"). */
  owner_kind: z.string(),
  /** ID of the entity that produced this object. */
  owner_id: z.string(),
  /** MIME type (e.g. "text/plain", "image/png"). */
  media_type: z.string(),
  /**
   * Byte length of the stored content.
   * Stored as UInt64 in CH; represented as number here (safe up to ~9 PB via
   * JS MAX_SAFE_INTEGER; content blobs extracted from trace events are orders
   * of magnitude smaller).
   */
  size_bytes: z.number(),
  /** Hex-encoded SHA-256 of the content bytes. Used for deduplication. */
  sha256: z.string(),
  /** Content-addressed URI (s3://... or file://...). */
  storage_uri: z.string(),
  /** When the caller says this content was first created (event timestamp). */
  created_at: z.date(),
  /** When this row was inserted into ClickHouse. */
  inserted_at: z.date(),
});

export type StoredObject = z.infer<typeof storedObjectSchema>;

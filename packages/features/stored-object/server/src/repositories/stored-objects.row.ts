/**
 * One row of the content-addressed `stored_objects` ClickHouse table.
 *
 * The field names are the column names on purpose: this shape is what the
 * table holds, and a camel-cased mirror of it would be a second vocabulary for
 * the same eleven columns.
 */
import { z } from "zod";

export const storedObjectSchema = z.object({
  /** Deterministic id derived from (project_id, sha256). */
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
   * Stored as UInt64 in ClickHouse; represented as number here (safe up to
   * ~9 PB via JS MAX_SAFE_INTEGER; content blobs extracted from trace events
   * are orders of magnitude smaller).
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

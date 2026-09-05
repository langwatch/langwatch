/**
 * The dataset-level gate's test fixture, shared by every suite that needs one.
 * @see ../catalog/types.ts — what the fields mean
 */

import type { LangWatchQLViewDefinition } from "../../services/langwatch-ql-catalog-shapes.service";

/**
 * A dataset that *is* captured content end to end.
 */
export const GATED_DATASET: LangWatchQLViewDefinition = {
  name: "transcripts",
  sourceTable: "raw_transcripts",
  description: "Everything said in a conversation, verbatim.",
  gates: ["input"],
  grain: "one row per (TenantId, TranscriptId)",
  joinKeys: ["TenantId"],
  timeColumn: "OccurredAt",
  freshness: "seconds behind ingestion",
  // Both key columns, so the dedup rule and the `grain` sentence say the same
  // thing — a fixture whose own two halves disagree teaches the reader the
  // wrong shape for a real catalog entry.
  dedup: {
    keyColumns: ["TenantId", "TranscriptId"],
    versionColumn: "UpdatedAt",
  },
  columns: [
    // Exposed because the entry advertises it as the join key and half the
    // grain — the shape the catalog invariants demand of every real entry, and
    // therefore the shape this fixture must teach.
    {
      name: "TenantId",
      type: "String",
      description: "Tenant the transcript belongs to.",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    {
      name: "TranscriptId",
      type: "String",
      description: "Transcript identifier.",
      gates: [],
      sourceColumns: ["TranscriptId"],
    },
    {
      name: "Spoken",
      type: "String",
      description: "What was said.",
      gates: ["output"],
      sourceColumns: ["Spoken"],
    },
  ],
};

/** The name a caller writes for {@link GATED_DATASET}, in the `analytics` database. */
export const GATED_DATASET_QUALIFIED_NAME = `analytics.${GATED_DATASET.name}`;

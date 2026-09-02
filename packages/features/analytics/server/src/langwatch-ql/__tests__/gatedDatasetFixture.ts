/**
 * The dataset-level gate's test fixture, shared by every suite that needs one.
 *
 * A dataset gated as a whole is the case `LangWatchQLViewDefinition.gates` exists
 * for, and the shipped catalog deliberately contains none — `lwqlViewCatalog`
 * pins that, so a case written against the shipped catalog would be asserting
 * that nothing happens. Every suite exercising the mechanism therefore needs a
 * fixture, and one shared definition is what keeps them exercising the *same*
 * mechanism: three private copies had already drifted apart on their dedup keys
 * and their column lists, so a suite could pass against a shape no other suite
 * agreed with.
 *
 * Not a `.test.ts` file, so vitest does not collect it.
 *
 * @see ../catalog/types.ts — what the fields mean
 */

import type { LangWatchQLViewDefinition } from "../catalog/types";

/**
 * A dataset that *is* captured content end to end.
 *
 * Deliberately shaped so both halves of the gate are exercised by one entry:
 * `TranscriptId` is ungated and therefore reachable *only* through the
 * dataset's own `input` gate, while `Spoken` adds `output` on top of it — which
 * is what lets a suite tell "the dataset's permission was applied" apart from
 * "the column already required that permission".
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

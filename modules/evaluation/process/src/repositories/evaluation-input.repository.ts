import type { EvaluationInputRetentionClass } from "../rules/evaluation-input-object.rules.ts";

/** Stores Evaluation-owned oversized input payloads under the evaluation-inputs prefix. */
export interface EvaluationInputRepository {
  /** Content-addressed: the same bytes in the same class write the same key. */
  store(input: {
    tenantId: string;
    retentionClass: EvaluationInputRetentionClass;
    bytes: Uint8Array;
  }): Promise<{ key: string; sha256: string }>;

  /** Reads the object a marker names; a key that is not this tenant's answers absent. */
  read(input: { tenantId: string; key: string }): Promise<StoredEvaluationInput>;
}

/** A stored input's bytes, or that no object answers the key. */
export type StoredEvaluationInput =
  | Readonly<{ kind: "stored"; body: AsyncIterable<Uint8Array> }>
  | Readonly<{ kind: "absent" }>;

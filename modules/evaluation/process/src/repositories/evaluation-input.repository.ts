/** Stores Evaluation-owned oversized input payloads behind durable members. */
export interface EvaluationInputRepository {
  store(input: {
    tenantId: string;
    evaluationId: string;
    bytes: Uint8Array;
  }): Promise<{ id: string }>;

  read(input: { tenantId: string; id: string }): Promise<StoredEvaluationInput>;
}

/** A stored input's bytes, or that no object answers the id. */
export type StoredEvaluationInput =
  | Readonly<{ kind: "stored"; body: AsyncIterable<Uint8Array> }>
  | Readonly<{ kind: "absent" }>;

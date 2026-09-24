import { createHash } from "node:crypto";

import type { EvaluationInputStorage } from "../../app/evaluation.members.ts";

/** The memory twin of the object-storage input repository: same ids, same unknown-id answer. */
export class MemoryEvaluationInputRepository implements EvaluationInputStorage {
  static create(): MemoryEvaluationInputRepository {
    return new MemoryEvaluationInputRepository();
  }

  readonly #objects = new Map<string, Uint8Array>();

  private constructor() {}

  async store(input: {
    tenantId: string;
    evaluationId: string;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    const id = createHash("sha256").update(input.evaluationId).digest("hex");
    this.#objects.set(`${input.tenantId}/${id}`, input.bytes.slice());

    return { id };
  }

  async tryRead(input: {
    tenantId: string;
    id: string;
  }): Promise<AsyncIterable<Uint8Array> | null> {
    const bytes = this.#objects.get(`${input.tenantId}/${input.id}`);
    return bytes ? once(bytes) : null;
  }
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

import { createHash } from "node:crypto";

import {
  evaluationInputKey,
  isEvaluationInputKeyOf,
} from "../../rules/evaluation-input-object.rules.ts";
import type {
  EvaluationInputRepository,
  StoredEvaluationInput,
} from "../evaluation-input.repository.ts";

/** The memory twin of the object-storage input repository: same keys, same unknown-key answer. */
export class MemoryEvaluationInputRepository implements EvaluationInputRepository {
  static create(): MemoryEvaluationInputRepository {
    return new MemoryEvaluationInputRepository();
  }

  readonly #objects = new Map<string, Uint8Array>();

  private constructor() {}

  async store(
    input: Parameters<EvaluationInputRepository["store"]>[0],
  ): Promise<{ key: string; sha256: string }> {
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const key = evaluationInputKey({
      retentionClass: input.retentionClass,
      tenantId: input.tenantId,
      sha256,
    });
    this.#objects.set(`${input.tenantId}\0${key}`, input.bytes.slice());

    return { key, sha256 };
  }

  async read(input: { tenantId: string; key: string }): Promise<StoredEvaluationInput> {
    if (!isEvaluationInputKeyOf(input)) return { kind: "absent" };
    const bytes = this.#objects.get(`${input.tenantId}\0${input.key}`);
    return bytes ? { kind: "stored", body: once(bytes) } : { kind: "absent" };
  }
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

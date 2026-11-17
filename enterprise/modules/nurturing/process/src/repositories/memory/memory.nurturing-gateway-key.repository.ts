// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { nowEpochMs } from "@langwatch/time";

import {
  foldVirtualKeyFact,
  forgetPersonOnKey,
  type NurturingVirtualKey,
  type NurturingVirtualKeyFact,
} from "../../rules/nurturing-virtual-key.rules.ts";
import type { NurturingVirtualKeyRepository } from "../nurturing-gateway-key.repository.ts";

/** The Postgres twin's semantics: every fact folds in by the key copy's rules. */
export class MemoryNurturingVirtualKeyRepository implements NurturingVirtualKeyRepository {
  static create(): MemoryNurturingVirtualKeyRepository {
    return new MemoryNurturingVirtualKeyRepository();
  }

  readonly #keys = new Map<string, NurturingVirtualKey>();

  private constructor() {}

  async recordKeyFact({ fact }: Readonly<{ fact: NurturingVirtualKeyFact }>): Promise<void> {
    const held = this.#keys.get(fact.virtualKeyId) ?? null;
    // As the Postgres upsert: a key never moves organization, so another's fact changes nothing.
    if (held && held.organizationId !== fact.organizationId) return;
    this.#keys.set(fact.virtualKeyId, foldVirtualKeyFact({ held, fact }));
  }

  async findKey({
    organizationId,
    virtualKeyId,
  }: Readonly<{
    organizationId: string;
    virtualKeyId: string;
  }>): Promise<NurturingVirtualKey[]> {
    const key = this.#keys.get(virtualKeyId);
    return key?.organizationId === organizationId ? [key] : [];
  }

  async forgetUser({ userId }: Readonly<{ userId: string }>): Promise<void> {
    const erasedAt = nowEpochMs();
    for (const [virtualKeyId, key] of this.#keys) {
      this.#keys.set(virtualKeyId, forgetPersonOnKey({ key, userId, erasedAt }));
    }
  }
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingVirtualKey,
  NurturingVirtualKeyFact,
} from "../rules/nurturing-virtual-key.rules.ts";

/**
 * Nurturing's own copy of each gateway key (`NurturingVirtualKey`), folded from gateway's
 * lifecycle facts (§9), so a budget crossing finds its key's name, holder and state without
 * reading gateway's tables.
 */
export interface NurturingVirtualKeyRepository {
  /** Folds one fact in by `foldVirtualKeyFact`: a redelivered or late fact changes nothing. */
  recordKeyFact(input: Readonly<{ fact: NurturingVirtualKeyFact }>): Promise<void>;
  /** The organization's copy of the key; empty when nurturing saw no fact of it. */
  findKey(
    input: Readonly<{ organizationId: string; virtualKeyId: string }>,
  ): Promise<NurturingVirtualKey[]>;
  /** Clears an erased account from every key copy; no fact stamped before it restores them. */
  forgetUser(input: Readonly<{ userId: string }>): Promise<void>;
}

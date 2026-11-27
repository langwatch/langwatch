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
  /**
   * Folds one fact in by `foldVirtualKeyFactWithoutErased`: a redelivered or late fact changes
   * nothing, and a marked person it names is stored nowhere.
   */
  recordKeyFact(input: Readonly<{ fact: NurturingVirtualKeyFact }>): Promise<void>;
  /** The organization's copy of the key; empty when nurturing saw no fact of it. */
  findKey(
    input: Readonly<{ organizationId: string; virtualKeyId: string }>,
  ): Promise<NurturingVirtualKey[]>;
  /**
   * Marks an erased account and clears it from every key copy: no fact folded in afterwards names
   * it again, whatever key it is for and whenever it was stamped.
   */
  forgetUser(input: Readonly<{ userId: string }>): Promise<void>;
}

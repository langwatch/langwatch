import {
  LEGACY_MICROSOFT_ISSUER,
  MICROSOFT_PROVIDER_ID,
} from "../../rules/microsoft-account-key-move.rules.ts";
import type {
  AccountKeyMove,
  AccountKeyMoveResult,
  IdentityAccountRekeyRepository,
} from "../identity-account-rekey.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

/** The move over the memory store's `Account` and `Identifier` rows. */
export class MemoryIdentityAccountRekeyRepository implements IdentityAccountRekeyRepository {
  static create(store: MemoryIdentityStore): MemoryIdentityAccountRekeyRepository {
    return new MemoryIdentityAccountRekeyRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async moveLegacyMicrosoftAccount(move: AccountKeyMove): Promise<AccountKeyMoveResult> {
    const rows = [...this.store.accounts.values()].flat();
    const microsoft = rows.filter((row) => row.provider === MICROSOFT_PROVIDER_ID);
    if (microsoft.some((row) => row.providerAccountId === move.accountId)) return "unchanged";

    const legacy = microsoft.find(
      (row) =>
        row.providerAccountId === move.legacySubject && row.issuer === LEGACY_MICROSOFT_ISSUER,
    );
    if (!legacy) return "unchanged";

    legacy.issuer = move.issuer;
    legacy.providerAccountId = move.accountId;
    for (const [id, fact] of this.store.identifiers) {
      if (fact.accountId !== legacy.id) continue;
      this.store.identifiers.set(id, {
        ...fact,
        issuer: move.issuer,
        providerAccountId: move.accountId,
      });
    }
    return "rekeyed";
  }
}

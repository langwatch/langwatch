import { normalizeIdentifierValue } from "@langwatch/identity-contract";
import type { CleanedWhere } from "better-auth/adapters";

import type { AccountWhere } from "../rules/better-auth-account-queries.rules.ts";
import {
  type AdapterNaming,
  canonicalKeysOf,
  canonicalWhereOf,
  readIdentified,
  type StorageRow as Row,
} from "../rules/better-auth-storage-rows.rules.ts";
import type { IdentityAccountCeremonies } from "../rules/ceremony-types.rules.ts";
import type { IdentityResolver } from "../rules/identity-storage.rules.ts";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";

export interface UserBranchDeps {
  naming: AdapterNaming;
  resolution: IdentityResolver;
  ceremonies: IdentityAccountCeremonies;
  isUserOnIdentityWrites: IdentityUserGate;
}

/** The `user` model on the identity branch: sign-in by address, and an email change as a
 *  command. */
export class BetterAuthUserBranchService {
  static create(deps: UserBranchDeps): BetterAuthUserBranchService {
    return new BetterAuthUserBranchService(deps);
  }

  private readonly naming: AdapterNaming;

  private constructor(private readonly deps: UserBranchDeps) {
    this.naming = deps.naming;
  }

  /** The record a `user` query names outright — the same narrowing
   *  `namedUserId` applies, one field over, because on the `user` model the
   *  user IS the record. */
  private readonly namedRecordId = (where: readonly AccountWhere[]): string | null => {
    const clause = where.find(
      (candidate) =>
        candidate.field === "id" &&
        (candidate.operator === undefined || candidate.operator === "eq") &&
        (candidate.connector === undefined || candidate.connector.toUpperCase() === "AND"),
    );
    return typeof clause?.value === "string" ? clause.value : null;
  };

  /**
   * The identifier-first half of `findUserByEmail` (ADR-116 §6): the
   */
  readonly resolveUserWhere = async (
    model: string,
    where: readonly CleanedWhere[],
  ): Promise<CleanedWhere[]> => {
    const clause = where[0];
    if (where.length !== 1 || clause === undefined) return [...where];
    if (this.naming.getDefaultFieldName({ model, field: clause.field }) !== "email")
      return [...where];
    if (clause.operator !== "eq" || typeof clause.value !== "string") return [...where];
    const resolved = await readIdentified(
      this.deps.resolution.getResolutionByIdentifierValue({
        normalizedValue: normalizeIdentifierValue(clause.value),
      }),
    );
    if (resolved.kind === "missing" || !resolved.value.finalized) return [...where];
    return [
      {
        field: this.naming.getFieldName({ model, field: "id" }),
        value: resolved.value.userId,
        operator: "eq",
        connector: "AND",
        mode: "sensitive",
      },
    ];
  };

  /**
   * A `user` update on the identity branch, with `email` taken out of it
   * (ADR-116 §6) — or the update exactly as it arrived.
   */
  readonly withoutRoutedEmail = async ({
    model,
    where,
    update,
  }: {
    model: string;
    where: readonly CleanedWhere[] | undefined;
    update: Row;
  }): Promise<Row> => {
    const canonical = canonicalKeysOf({ naming: this.naming, model, data: update });
    const email = canonical.email;
    if (typeof email !== "string") return update;
    const named = this.namedRecordId(canonicalWhereOf({ naming: this.naming, model, where }));
    if (named === null || !(await this.deps.isUserOnIdentityWrites({ userId: named }))) {
      return update;
    }
    await this.deps.ceremonies.beforeEmailChange({ userId: named, email });
    return Object.fromEntries(
      Object.entries(update).filter(
        ([field]) => this.naming.getDefaultFieldName({ model, field }) !== "email",
      ),
    );
  };
}

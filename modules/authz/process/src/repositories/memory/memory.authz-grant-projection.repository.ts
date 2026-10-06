import { type Instant, nowInstant, Temporal } from "@langwatch/time";

import { isMigrationOwnedSource } from "../../rules/authz-migration-ownership.rules.ts";
import {
  AuthzGrantProjectionRepository,
  type GrantProjectionWrite,
} from "../authz-grant-projection.repository.ts";
import {
  compatBindingFromGrantFact,
  compatShareLinkFromGrantFact,
  type CompatBindingRowShape,
  type CompatShareLinkRowShape,
  type GrantRowShape,
  grantRowToFact,
  type RoleRowShape,
} from "../prisma/prisma.authz-grant.mapper.ts";
import type { AuthzMemoryCustomRoleRow, AuthzMemoryStore } from "./authz-memory.store.ts";

/** A unique key said no: Postgres refuses the compat write and the fold steps over it. */
class CompatConflict extends Error {}

/** Postgres keeps milliseconds, so a guard compares and stores what it would have kept. */
const atMillis = (instant: Instant): Instant =>
  Temporal.Instant.fromEpochMilliseconds(instant.epochMilliseconds);

const msOf = (instant: Instant): number => instant.epochMilliseconds;

/** `NOW()` and `@updatedAt`, at the precision Postgres keeps. */
const now = (): Instant => atMillis(nowInstant());

/** `Grant_resource_terms_check`: a RESOURCE row holds all four resource terms, any other none. */
function holdsResourceTerms(row: GrantRowShape): boolean {
  const terms = [row.token, row.permission, row.resourceKind, row.projectId];
  const held = terms.filter((term) => term !== null).length;
  return row.scopeType === "RESOURCE" ? held === terms.length : held === 0;
}

/** `RoleBinding_custom_role_check` and `RoleBinding_principal_check`. */
function isValidBinding(binding: CompatBindingRowShape): boolean {
  const principals = [binding.userId, binding.groupId, binding.apiKeyId];
  return (
    (binding.role === "CUSTOM") === (binding.customRoleId !== null) &&
    principals.filter((principal) => principal !== null).length === 1
  );
}

/**
 * The guarded projection writes over the memory heads, with the Prisma statements' rules: a
 * whole-row write needs a strictly newer business time, a one-field write a newer or equal one,
 * a mark is never moved, and the compat heads follow the authoritative row.
 */
export class MemoryAuthzGrantProjectionRepository extends AuthzGrantProjectionRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzGrantProjectionRepository {
    return new MemoryAuthzGrantProjectionRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async append(write: GrantProjectionWrite): Promise<void> {
    const affected = this.statementFor(write);
    this.writeCompatHead(write, affected);
  }

  async bulkAppend(writes: GrantProjectionWrite[]): Promise<void> {
    const grants = this.memory.grants.map((row) => ({ ...row }));
    const roleHeads = this.memory.roleHeads.map((row) => ({ ...row }));
    let affected: number[];
    try {
      affected = writes.map((write) => this.statementFor(write));
    } catch (error) {
      this.memory.grants.splice(0, this.memory.grants.length, ...grants);
      this.memory.roleHeads.splice(0, this.memory.roleHeads.length, ...roleHeads);
      throw error;
    }
    writes.forEach((write, index) => this.writeCompatHead(write, affected[index] ?? 0));
  }

  private statementFor(write: GrantProjectionWrite): number {
    switch (write.kind) {
      case "grant.upsert":
        return this.upsertGrant(write);
      case "grant.setRole":
        return this.updateGrants(
          (row) => row.id === write.grantId && msOf(row.occurredAt) <= msOf(write.occurredAt),
          (row) => {
            row.roleKey = write.roleKey;
            row.legacyRole = null;
            row.occurredAt = atMillis(write.occurredAt);
          },
        );
      case "grant.revoke":
        return this.updateGrants(
          (row) =>
            row.id === write.grantId &&
            row.organizationId === write.organizationId &&
            row.revokedAt === null &&
            msOf(row.occurredAt) <= msOf(write.occurredAt),
          (row) => {
            row.revokedAt = atMillis(write.occurredAt);
            row.revokedReason = write.reason;
            row.occurredAt = atMillis(write.occurredAt);
          },
        );
      case "role.upsert":
        return this.upsertRole(write.row);
      case "role.setPermissions":
        return this.updateRoleHead(
          (row) => row.id === write.roleId && msOf(row.occurredAt) <= msOf(write.occurredAt),
          (row) => {
            row.permissions = [...write.permissions];
            row.occurredAt = atMillis(write.occurredAt);
          },
        );
      case "role.delete":
        return this.updateRoleHead(
          (row) =>
            row.id === write.roleId &&
            row.deletedAt === null &&
            msOf(row.occurredAt) <= msOf(write.occurredAt),
          (row) => {
            row.deletedAt = atMillis(write.occurredAt);
            row.occurredAt = atMillis(write.occurredAt);
          },
        );
    }
  }

  private upsertGrant(write: Extract<GrantProjectionWrite, { kind: "grant.upsert" }>): number {
    const { row } = write;
    if (!this.admitsMembership(write)) return 0;
    if (!holdsResourceTerms(row)) {
      throw new Error(`Grant "${row.id}" violates check constraint "Grant_resource_terms_check".`);
    }
    const holder = this.memory.grants.find(
      (stored) => row.token !== null && stored.token === row.token && stored.id !== row.id,
    );
    if (holder) {
      throw new Error(`Grant "${row.id}" violates unique constraint "Grant_token_key".`);
    }
    const stored = { ...row, occurredAt: atMillis(row.occurredAt) };
    const existing = this.memory.grants.find((candidate) => candidate.id === row.id);
    if (!existing) {
      this.memory.grants.push({
        ...stored,
        createdAt: now(),
        revokedAt: null,
        revokedReason: null,
        updatedAt: now(),
      });
      return 1;
    }
    if (msOf(existing.occurredAt) >= msOf(row.occurredAt)) return 0;
    Object.assign(existing, stored, { updatedAt: now() });
    return 1;
  }

  /** The membership fence the Prisma insert carries in its leading WHERE. */
  private admitsMembership({
    row,
    membershipStamp,
    membershipBootstrap,
  }: Extract<GrantProjectionWrite, { kind: "grant.upsert" }>): boolean {
    if (membershipStamp === undefined || row.principalType !== "USER") return true;
    const live = this.memory.memberships.get(
      this.memory.membershipKey(row.organizationId, row.principalId ?? ""),
    );
    if (live?.membershipStamp === membershipStamp) return true;
    const bootstrapScopeIsAllowed =
      row.scopeType === "TEAM" ||
      (row.scopeType === "ORGANIZATION" && row.scopeId === row.organizationId);
    return (
      (membershipBootstrap ?? false) &&
      row.roleKey === "admin" &&
      bootstrapScopeIsAllowed &&
      !this.memory.organizations.has(row.organizationId)
    );
  }

  private upsertRole(row: RoleRowShape): number {
    const nameHeld = this.memory.roleHeads.some(
      (stored) =>
        stored.organizationId === row.organizationId &&
        stored.name === row.name &&
        stored.id !== row.id &&
        stored.deletedAt === null,
    );
    if (nameHeld) return 0;
    const stored = {
      ...row,
      permissions: [...row.permissions],
      occurredAt: atMillis(row.occurredAt),
    };
    const existing = this.memory.roleHeads.find((candidate) => candidate.id === row.id);
    if (!existing) {
      this.memory.roleHeads.push({ ...stored, deletedAt: null, updatedAt: now() });
      return 1;
    }
    if (msOf(existing.occurredAt) >= msOf(row.occurredAt)) return 0;
    Object.assign(existing, stored, { updatedAt: now() });
    return 1;
  }

  private updateGrants(
    matches: (row: AuthzMemoryStore["grants"][number]) => boolean,
    update: (row: AuthzMemoryStore["grants"][number]) => void,
  ): number {
    const rows = this.memory.grants.filter(matches);
    for (const row of rows) {
      update(row);
      row.updatedAt = now();
    }
    return rows.length;
  }

  private updateRoleHead(
    matches: (row: AuthzMemoryStore["roleHeads"][number]) => boolean,
    update: (row: AuthzMemoryStore["roleHeads"][number]) => void,
  ): number {
    const rows = this.memory.roleHeads.filter(matches);
    for (const row of rows) {
      update(row);
      row.updatedAt = now();
    }
    return rows.length;
  }

  /** Compat heads are best-effort, as in Postgres: a conflict skips the rest of this write's. */
  private writeCompatHead(write: GrantProjectionWrite, affected: number): void {
    try {
      this.compatFor(write, affected);
    } catch (error) {
      if (!(error instanceof CompatConflict)) throw error;
    }
  }

  private compatFor(write: GrantProjectionWrite, affected: number): void {
    switch (write.kind) {
      case "grant.upsert":
        return this.compatForGrant(write.row, affected > 0);
      case "grant.setRole":
        return this.compatForRoleChange(write.grantId);
      case "grant.revoke":
        return this.compatForRevoke(write);
      case "role.upsert":
        return this.compatForRole(write.row, affected > 0);
      case "role.setPermissions":
        for (const role of this.memory.roles) {
          if (role.id === write.roleId) role.permissions = [...write.permissions];
        }
        return;
      case "role.delete":
        return this.compatForRoleDelete(write.roleId);
    }
  }

  private compatForGrant(row: GrantRowShape, guardWon: boolean): void {
    if (guardWon) return this.upsertCompatForGrant(row);
    const authoritative = this.memory.grants.find((stored) => stored.id === row.id);
    if (!authoritative || authoritative.revokedAt !== null) {
      this.deleteCompatBinding({ organizationId: row.organizationId, id: row.id });
      if (row.projectId) this.deleteCompatShareLink({ projectId: row.projectId, id: row.id });
      return;
    }
    const { revokedAt: _revokedAt, revokedReason: _revokedReason, ...factRow } = authoritative;
    this.upsertCompatForGrant(factRow);
  }

  /** A migration-sourced fact only converges a row it adopted (ADR-110), never creates one. */
  private upsertCompatForGrant(row: GrantRowShape): void {
    const grant = grantRowToFact(row);
    const { organizationId } = row;
    const migrationSourced = isMigrationOwnedSource(grant.source);

    const compatBinding = compatBindingFromGrantFact({ grant, organizationId });
    if (compatBinding.kind === "compat") {
      this.writeCompatBinding({ binding: compatBinding.row, createMissing: !migrationSourced });
    }
    const compatLink = compatShareLinkFromGrantFact({ grant, organizationId });
    if (compatLink.kind === "compat") {
      this.writeCompatShareLink({ link: compatLink.row, createMissing: !migrationSourced });
    }
  }

  private writeCompatBinding({
    binding,
    createMissing,
  }: {
    binding: CompatBindingRowShape;
    createMissing: boolean;
  }): void {
    const existing = this.memory.bindings.find(
      (row) => row.id === binding.id && row.organizationId === binding.organizationId,
    );
    if ((existing || createMissing) && !isValidBinding(binding)) {
      throw new Error(`RoleBinding "${binding.id}" violates its role and principal checks.`);
    }
    if (existing) {
      Object.assign(existing, binding);
      return;
    }
    if (!createMissing) return;
    if (this.memory.bindings.some((row) => row.id === binding.id)) throw new CompatConflict();
    this.memory.bindings.push({ ...binding, createdAt: now() });
  }

  private writeCompatShareLink({
    link,
    createMissing,
  }: {
    link: CompatShareLinkRowShape;
    createMissing: boolean;
  }): void {
    const existing = this.memory.shareLinks.find(
      (row) => row.id === link.id && row.projectId === link.projectId,
    );
    const tokenHeld = this.memory.shareLinks.some(
      (row) => row.token === link.token && row.id !== link.id,
    );
    if (existing) {
      if (tokenHeld) throw new CompatConflict();
      Object.assign(existing, link);
      return;
    }
    if (!createMissing) return;
    if (tokenHeld || this.memory.shareLinks.some((row) => row.id === link.id)) {
      throw new CompatConflict();
    }
    this.memory.shareLinks.push({ ...link, viewCount: 0, createdAt: now() });
  }

  /** The compat row carries `(role, customRoleId)`, so a roleKey change re-reads the mapper. */
  private compatForRoleChange(grantId: string): void {
    const row = this.memory.grants.find((stored) => stored.id === grantId);
    if (!row) return;
    const { revokedAt: _revokedAt, revokedReason: _revokedReason, ...factRow } = row;
    const compat = compatBindingFromGrantFact({
      grant: grantRowToFact(factRow),
      organizationId: row.organizationId,
    });
    if (compat.kind === "noCompatForm") return;
    const bindings = this.memory.bindings.filter(
      (binding) => binding.organizationId === row.organizationId && binding.id === grantId,
    );
    if (bindings.length > 0 && !isValidBinding(compat.row)) {
      throw new Error(`RoleBinding "${grantId}" violates its role and principal checks.`);
    }
    for (const binding of bindings) {
      binding.role = compat.row.role;
      binding.customRoleId = compat.row.customRoleId;
    }
  }

  private compatForRevoke({
    grantId,
    organizationId,
  }: {
    grantId: string;
    organizationId: string;
  }): void {
    const row = this.memory.grants.find((stored) => stored.id === grantId);
    if (!row || row.organizationId !== organizationId) return;
    this.deleteCompatBinding({ organizationId, id: grantId });
    if (row.projectId) this.deleteCompatShareLink({ projectId: row.projectId, id: grantId });
  }

  private compatForRoleDelete(roleId: string): void {
    const role = this.memory.roleHeads.find((stored) => stored.id === roleId);
    if (!role) return;
    removeWhere(
      this.memory.bindings,
      (binding) =>
        binding.organizationId === role.organizationId && binding.customRoleId === roleId,
    );
    removeWhere(
      this.memory.roles,
      (custom) => custom.organizationId === role.organizationId && custom.id === roleId,
    );
  }

  /** A skipped write mirrors only a redelivery of the live head. */
  private compatForRole(row: RoleRowShape, guardWon: boolean): void {
    if (!guardWon) {
      const head = this.memory.roleHeads.find((stored) => stored.id === row.id);
      if (!head || head.deletedAt !== null) return;
      if (msOf(head.occurredAt) !== msOf(row.occurredAt)) return;
    }
    const compat: Omit<AuthzMemoryCustomRoleRow, "createdAt"> = {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      description: row.description,
      permissions: [...row.permissions],
      kind: row.kind,
    };
    const nameHeld = this.memory.roles.some(
      (custom) =>
        custom.organizationId === row.organizationId &&
        custom.name === row.name &&
        custom.id !== row.id,
    );
    if (nameHeld) throw new CompatConflict();
    const existing = this.memory.roles.find(
      (custom) => custom.id === row.id && custom.organizationId === row.organizationId,
    );
    if (existing) {
      Object.assign(existing, compat);
      return;
    }
    if (this.memory.roles.some((custom) => custom.id === row.id)) throw new CompatConflict();
    this.memory.roles.push({ ...compat, createdAt: now() });
  }

  private deleteCompatBinding({ organizationId, id }: { organizationId: string; id: string }) {
    removeWhere(
      this.memory.bindings,
      (binding) => binding.organizationId === organizationId && binding.id === id,
    );
  }

  private deleteCompatShareLink({ projectId, id }: { projectId: string; id: string }) {
    removeWhere(this.memory.shareLinks, (link) => link.projectId === projectId && link.id === id);
  }
}

function removeWhere<Row>(rows: Row[], matches: (row: Row) => boolean): void {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row !== undefined && matches(row)) rows.splice(index, 1);
  }
}

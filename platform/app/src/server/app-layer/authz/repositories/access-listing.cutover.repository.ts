/**
 * ADR-092 delivery-plan PR 3 follow-up — the Access surface's per-organization
 * repoint. One `AccessListingRepository` in front of two: the legacy compat
 * heads (`RoleBinding` / `CustomRole`) and the ledger's own projection
 * (`Grant` / `Role`). Each call resolves the organization it is about, asks
 * the SAME cutover gate the decision fork reads, and delegates - so the page
 * a person looks at and the engine deciding what they may do on it can never
 * be reading different heads for longer than the gate's cache window.
 *
 * Unlike the decision reader (`authz-read.cutover.repository.ts`), there is
 * no pass pinning here: every port method is one delegated call, and the
 * delegate finishes its own reads on the head it started on. A caller that
 * issues more than one call for a single page snapshot (the team detail view
 * asks for TEAM and PROJECT scope bindings separately) can therefore straddle
 * a gate flip — tolerated because the calls run concurrently inside the
 * gate's 60-second coalescing window, row ids are stable across the heads,
 * and a mixed render is a transient display artifact, never a decision. The
 * one multi-organization method partitions its organizations by the gate's
 * answer and asks both heads, each only about its own organizations.
 *
 * Browser-safety: like everything else under ./authz, this composes from a
 * caller-supplied Prisma handle and holds no module-scope storage.
 */
import type {
  CustomRole,
  Prisma,
  RoleBindingScopeType,
} from "~/generated/prisma/client";
import type {
  RoleBindingForSynthesis,
  TeamScopedMemberBinding,
} from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import { cutoverOnEngine } from "../cutover-gate";
import { GrantsAccessListingRepository } from "./access-listing.grants.repository";
import { PrismaAccessListingRepository } from "./access-listing.prisma.repository";
import type {
  AccessListingBindingRow,
  AccessListingRepository,
} from "./access-listing.repository";

export class CutoverAwareAccessListingRepository
  implements AccessListingRepository
{
  constructor(
    private readonly prisma: Prisma.TransactionClient,
    private readonly repositories: {
      legacy: AccessListingRepository;
      grants: AccessListingRepository;
    } = {
      legacy: new PrismaAccessListingRepository(prisma),
      grants: new GrantsAccessListingRepository(prisma),
    },
  ) {}

  async findUserBindings(args: {
    organizationId: string;
    userId: string;
  }): Promise<AccessListingBindingRow[]> {
    return (await this.readerFor(args.organizationId)).findUserBindings(args);
  }

  async findOrganizationBindings(args: {
    organizationId: string;
  }): Promise<AccessListingBindingRow[]> {
    return (await this.readerFor(args.organizationId)).findOrganizationBindings(
      args,
    );
  }

  async findUserAndGroupBindings(args: {
    organizationId: string;
    userId: string;
    groupIds: readonly string[];
  }): Promise<AccessListingBindingRow[]> {
    return (await this.readerFor(args.organizationId)).findUserAndGroupBindings(
      args,
    );
  }

  async findScopeBindings(args: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeIds: readonly string[];
  }): Promise<AccessListingBindingRow[]> {
    return (await this.readerFor(args.organizationId)).findScopeBindings(args);
  }

  async findGroupBindings(args: {
    organizationId: string;
    groupId: string;
  }): Promise<AccessListingBindingRow[]> {
    return (await this.readerFor(args.organizationId)).findGroupBindings(args);
  }

  async findTeamMemberBindings(args: {
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<Map<string, TeamScopedMemberBinding[]>> {
    return (await this.readerFor(args.organizationId)).findTeamMemberBindings(
      args,
    );
  }

  /** Partitioned, not pinned: each organization is asked about on the head
   *  the gate names for IT, and the answers concatenate - the rows carry
   *  their organizationId, and the consumer's synthesis keys on it. */
  async findBindingsForSynthesis({
    orgIds,
    userId,
  }: {
    orgIds: readonly string[];
    userId: string;
  }): Promise<RoleBindingForSynthesis[]> {
    if (orgIds.length === 0) return [];
    const answers = await Promise.all(
      orgIds.map(async (organizationId) => ({
        organizationId,
        onEngine: await this.onEngine(organizationId),
      })),
    );
    const onEngine = answers
      .filter((answer) => answer.onEngine)
      .map((answer) => answer.organizationId);
    const onLegacy = answers
      .filter((answer) => !answer.onEngine)
      .map((answer) => answer.organizationId);
    const [legacyRows, grantsRows] = await Promise.all([
      onLegacy.length > 0
        ? this.repositories.legacy.findBindingsForSynthesis({
            orgIds: onLegacy,
            userId,
          })
        : [],
      onEngine.length > 0
        ? this.repositories.grants.findBindingsForSynthesis({
            orgIds: onEngine,
            userId,
          })
        : [],
    ]);
    return [...legacyRows, ...grantsRows];
  }

  async findUserCreatedRoles(args: {
    organizationId: string;
  }): Promise<CustomRole[]> {
    return (await this.readerFor(args.organizationId)).findUserCreatedRoles(
      args,
    );
  }

  private async readerFor(
    organizationId: string,
  ): Promise<AccessListingRepository> {
    return (await this.onEngine(organizationId))
      ? this.repositories.grants
      : this.repositories.legacy;
  }

  private async onEngine(organizationId: string): Promise<boolean> {
    return cutoverOnEngine({ prisma: this.prisma, organizationId });
  }
}

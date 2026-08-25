/**
 * ADR-092 delivery-plan PR 3 — the collector's per-organization repoint. One
 * `AuthzReadRepository` in front of two: the legacy compat heads
 * (`RoleBinding` / `CustomRole` / `ShareLink`) and the ledger's own projection
 * (`Grant` / `Role` / `GrantUsage`). Each call resolves the organization it is
 * about, asks the cutover gate whether that organization is served by the
 * engine, and delegates.
 *
 * `findOrganizationRole`, `findApiKeyOwner`, `findProjectLineage` and
 * `findTeamOrganization` go to legacy always, unconditionally - not an
 * exception to the fork: membership and lineage are not grants and were
 * never projected onto the ledger's head, so both implementations run the
 * SAME query against the SAME table. Forking them would buy a caller nothing
 * and cost a gate read per call. Every other read goes through `readerFor`,
 * gated on the organization it is about (`findShareLinks`'s organization
 * comes from the project's lineage - see below).
 *
 * `findShareLinks` carries a project, not an organization - the port's shape,
 * because ShareLink's tenancy is its project. The lineage read that resolves
 * it is the one the collector performs anyway to build the resource scope.
 * When the project is unknown there is no organization to ask about, so the
 * call goes to legacy: an unresolvable scope must not be a silent head swap.
 *
 * ONE HEAD PER PASS. The gate's answer is cached with a TTL, and a collect is
 * several reads: without a pass boundary that TTL can expire BETWEEN two of
 * them, and the snapshot the engine decides from is half compat bindings and
 * half ledger grants - a state that never existed in either head. So the
 * decision is memoized per organization for the lifetime of ONE instance, and
 * `beginPass()` hands the collector a fresh instance to hold for exactly one
 * snapshot.
 *
 * The memo has to be per-pass rather than per-instance-forever because the
 * composition root holds ONE of these for the whole process
 * (`authz/runtime.ts`'s `authzCollector`): pinning that instance would pin
 * every organization's head until the pod restarted, and a rollback - the
 * emergency lever - would stop working. Instances the fork and shadow compose
 * per request are short-lived either way, so both shapes agree on the same
 * rule: a pin lasts one snapshot, never longer.
 *
 * Browser-safety: like everything else under ./authz, this composes from a
 * caller-supplied Prisma handle and holds no module-scope storage.
 */
import type {
  AuthzPrincipalRef,
  CollectedBinding,
  LegacyTeamMembership,
  ShareableResourceKind,
} from "@langwatch/authz-contract";
import {
  AuthzReadRepository,
  type AuthzDatabase,
  type AuthzReadHeadSelector,
  type CustomRolePermissionsRow,
  type OrganizationRole,
  type ShareLinkRow,
} from "../authz-read.repository";
import { EventingAuthzReadRepository } from "../eventing/eventing.authz-read.repository";
import { PrismaAuthzReadRepository } from "../prisma/prisma.authz-read.repository";

type AuthzReadHeads = Readonly<{
  legacy: AuthzReadRepository;
  eventing: AuthzReadRepository;
}>;

export class RoutedAuthzReadRepository extends AuthzReadRepository {
  /**
   * The head this instance has already committed to, per organization. A
   * PROMISE rather than a resolved value, so two reads racing inside one pass
   * share the one gate call instead of both starting their own.
   */
  private readonly pinnedHeads = new Map<
    string,
    Promise<AuthzReadRepository>
  >();

  static create({
    database,
    selectHead,
    repositories = {
      legacy: PrismaAuthzReadRepository.create(database),
      eventing: EventingAuthzReadRepository.create(database),
    },
  }: {
    database: AuthzDatabase;
    selectHead: AuthzReadHeadSelector;
    repositories?: AuthzReadHeads;
  }): RoutedAuthzReadRepository {
    return new RoutedAuthzReadRepository(selectHead, repositories);
  }

  private constructor(
    private readonly selectHead: AuthzReadHeadSelector,
    private readonly repositories: AuthzReadHeads,
  ) {
    super();
  }

  /** A view of this decorator whose head pins for one snapshot — see the
   *  module comment for why the pin may not outlive it. */
  beginPass(): AuthzReadRepository {
    return new RoutedAuthzReadRepository(this.selectHead, this.repositories);
  }

  async tryFindOrganizationRole(args: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationRole | null> {
    return this.repositories.legacy.tryFindOrganizationRole(args);
  }

  async findUserBindings(args: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    return (await this.readerFor(args.organizationId)).findUserBindings(args);
  }

  async findGroupBindings(args: {
    userId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    return (await this.readerFor(args.organizationId)).findGroupBindings(args);
  }

  async findApiKeyBindings(args: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<CollectedBinding[]> {
    return (await this.readerFor(args.organizationId)).findApiKeyBindings(args);
  }

  async tryFindApiKeyOwner(
    apiKeyId: string,
  ): Promise<{ userId: string | null } | null> {
    return this.repositories.legacy.tryFindApiKeyOwner(apiKeyId);
  }

  async findLegacyTeamMemberships(args: {
    userId: string;
    organizationId: string;
  }): Promise<LegacyTeamMembership[]> {
    return (
      await this.readerFor(args.organizationId)
    ).findLegacyTeamMemberships(args);
  }

  async findCustomRolePermissions(args: {
    organizationId: string;
    principal: AuthzPrincipalRef;
    customRoleIds: readonly string[];
  }): Promise<CustomRolePermissionsRow[]> {
    return (
      await this.readerFor(args.organizationId)
    ).findCustomRolePermissions(args);
  }

  async findShareLinks(args: {
    projectId: string;
    tokens: readonly string[];
    links: ReadonlyArray<{ kind: ShareableResourceKind; id: string }>;
  }): Promise<ShareLinkRow[]> {
    const lineage = await this.repositories.legacy.tryFindProjectLineage({
      projectId: args.projectId,
    });
    if (!lineage) return this.repositories.legacy.findShareLinks(args);
    // The organization is already known from the lineage read above - handed
    // straight to the reader rather than left for it to resolve a second
    // time. Without this, a cut-over organization's share-link check ran the
    // same lineage query twice: once here to pick the head, once more inside
    // `EventingAuthzReadRepository.findShareLinks` to
    // learn the organization its own query needed.
    return (await this.readerFor(lineage.organizationId)).findShareLinks({
      ...args,
      organizationId: lineage.organizationId,
    });
  }

  async tryFindProjectLineage(args: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null> {
    return this.repositories.legacy.tryFindProjectLineage(args);
  }

  async tryFindTeamOrganization(args: {
    teamId: string;
  }): Promise<{ organizationId: string } | null> {
    return this.repositories.legacy.tryFindTeamOrganization(args);
  }

  private async readerFor(
    organizationId: string,
  ): Promise<AuthzReadRepository> {
    const pinned = this.pinnedHeads.get(organizationId);
    if (pinned) return pinned;
    const resolving = this.selectHead(organizationId).then((onEngine) =>
      onEngine ? this.repositories.eventing : this.repositories.legacy,
    );
    this.pinnedHeads.set(organizationId, resolving);
    return resolving;
  }
}

// Routed per cutover gate; memoized per-pass to prevent head flip between reads.
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
  type OrganizationMembership,
  type ShareLinkRow,
} from "../authz-read.repository.ts";
import { EventingAuthzReadRepository } from "../eventing/eventing.authz-read.repository.ts";
import { PrismaAuthzReadRepository } from "../prisma/prisma.authz-read.repository.ts";

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
  private readonly pinnedHeads = new Map<string, Promise<AuthzReadRepository>>();

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

  async findOrganizationMembership(args: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationMembership | null> {
    return this.repositories.legacy.findOrganizationMembership(args);
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

  async findApiKeyOwner(apiKeyId: string): Promise<{ userId: string | null } | null> {
    return this.repositories.legacy.findApiKeyOwner(apiKeyId);
  }

  async findLegacyTeamMemberships(args: {
    userId: string;
    organizationId: string;
  }): Promise<LegacyTeamMembership[]> {
    return (await this.readerFor(args.organizationId)).findLegacyTeamMemberships(args);
  }

  async findCustomRolePermissions(args: {
    organizationId: string;
    principal: AuthzPrincipalRef;
    customRoleIds: readonly string[];
  }): Promise<CustomRolePermissionsRow[]> {
    return (await this.readerFor(args.organizationId)).findCustomRolePermissions(args);
  }

  async findShareLinks(args: {
    projectId: string;
    tokens: readonly string[];
    links: readonly { kind: ShareableResourceKind; id: string }[];
  }): Promise<ShareLinkRow[]> {
    const lineage = await this.repositories.legacy.findProjectLineage({
      projectId: args.projectId,
    });
    if (!lineage) return this.repositories.legacy.findShareLinks(args);
    // The organization is already known from the lineage read above and is
    // handed straight to the reader rather than left for it to resolve
    // again - otherwise a cut-over organization's share-link check ran the
    // same lineage query twice.
    return (await this.readerFor(lineage.organizationId)).findShareLinks({
      ...args,
      organizationId: lineage.organizationId,
    });
  }

  async findProjectLineage(args: {
    projectId: string;
  }): Promise<{ teamId: string; organizationId: string } | null> {
    return this.repositories.legacy.findProjectLineage(args);
  }

  async findTeamOrganization(args: {
    teamId: string;
  }): Promise<{ organizationId: string } | null> {
    return this.repositories.legacy.findTeamOrganization(args);
  }

  private async readerFor(organizationId: string): Promise<AuthzReadRepository> {
    const pinned = this.pinnedHeads.get(organizationId);
    if (pinned) return pinned;
    const resolving = this.selectHead(organizationId).then((onEngine) =>
      onEngine ? this.repositories.eventing : this.repositories.legacy,
    );
    this.pinnedHeads.set(organizationId, resolving);
    return resolving;
  }
}

// Routed per cutover gate; no pass pinning; every call delegates on its own head.
import type {
  AuthzAccessBinding,
  AuthzBindingForSynthesis,
  AuthzCustomRole,
  AuthzTeamMemberBinding,
  RoleBindingScopeType,
} from "@langwatch/authz-contract";
import { AuthzListingRepository } from "../authz-listing.repository.ts";
import type { AuthzDatabase, AuthzReadHeadSelector } from "../authz-read.repository.ts";
import { EventingAuthzListingRepository } from "../eventing/eventing.authz-listing.repository.ts";
import { PrismaAuthzListingRepository } from "../prisma/prisma.authz-listing.repository.ts";

type AuthzListingHeads = Readonly<{
  legacy: AuthzListingRepository;
  eventing: AuthzListingRepository;
}>;

export class RoutedAuthzListingRepository extends AuthzListingRepository {
  static create({
    database,
    selectHead,
    repositories = {
      legacy: PrismaAuthzListingRepository.create(database),
      eventing: EventingAuthzListingRepository.create(database),
    },
  }: {
    database: AuthzDatabase;
    selectHead: AuthzReadHeadSelector;
    repositories?: AuthzListingHeads;
  }): RoutedAuthzListingRepository {
    return new RoutedAuthzListingRepository(selectHead, repositories);
  }

  private constructor(
    private readonly selectHead: AuthzReadHeadSelector,
    private readonly repositories: AuthzListingHeads,
  ) {
    super();
  }

  // Arrow instance properties, matching the base class's property-typed
  // abstract members (AuthzListingRepository declares them that way for
  // test mocks).
  findUserBindings = async (args: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzAccessBinding[]> => {
    return (await this.readerFor(args.organizationId)).findUserBindings(args);
  };

  findOrganizationBindings = async (args: {
    organizationId: string;
  }): Promise<AuthzAccessBinding[]> => {
    return (await this.readerFor(args.organizationId)).findOrganizationBindings(args);
  };

  findUserAndGroupBindings = async (args: {
    organizationId: string;
    userId: string;
    groupIds: readonly string[];
  }): Promise<AuthzAccessBinding[]> => {
    return (await this.readerFor(args.organizationId)).findUserAndGroupBindings(args);
  };

  findScopeBindings = async (args: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeIds: readonly string[];
  }): Promise<AuthzAccessBinding[]> => {
    return (await this.readerFor(args.organizationId)).findScopeBindings(args);
  };

  findGroupBindings = async (args: {
    organizationId: string;
    groupId: string;
  }): Promise<AuthzAccessBinding[]> => {
    return (await this.readerFor(args.organizationId)).findGroupBindings(args);
  };

  findTeamMemberBindings = async (args: {
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<Map<string, AuthzTeamMemberBinding[]>> => {
    return (await this.readerFor(args.organizationId)).findTeamMemberBindings(args);
  };

  /** Partitioned, not pinned: each organization is asked about on the head
   *  the gate names for IT, and the answers concatenate - the rows carry
   *  their organizationId, and the consumer's synthesis keys on it. */
  findBindingsForSynthesis = async ({
    orgIds,
    userId,
  }: {
    orgIds: readonly string[];
    userId: string;
  }): Promise<AuthzBindingForSynthesis[]> => {
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
        ? this.repositories.eventing.findBindingsForSynthesis({
            orgIds: onEngine,
            userId,
          })
        : [],
    ]);
    return [...legacyRows, ...grantsRows];
  };

  findUserCreatedRoles = async (args: { organizationId: string }): Promise<AuthzCustomRole[]> => {
    return (await this.readerFor(args.organizationId)).findUserCreatedRoles(args);
  };

  private async readerFor(organizationId: string): Promise<AuthzListingRepository> {
    return (await this.onEngine(organizationId))
      ? this.repositories.eventing
      : this.repositories.legacy;
  }

  private async onEngine(organizationId: string): Promise<boolean> {
    return this.selectHead(organizationId);
  }
}

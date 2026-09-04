/**
 * The API process's answer to `AppTrpcFeaturePorts` — the capabilities the
 * twenty-two packaged tRPC namespaces reach that their own feature packages do
 * not own.
 *
 * This is where the platform application's ports object moved to. Two things
 * changed on the way, and only two:
 *
 *  1. The entries that were ROW READS now run on this process's own guarded
 *     Prisma connection instead of the one hanging off a request context.
 *     There were about forty of them — the workflow copy lineage, the user
 *     rows behind the /me screens, the studio's published components — and
 *     every one of them already had its project or user id in hand. They never
 *     needed a service locator, only a connection.
 *
 *     Four of them have since left again, and the reason names the limit of
 *     rule 1: they read `Account`, where the stored password hash lives, and
 *     "a row read with an id already in hand" is not a licence to select a
 *     credential column. They are the user feature's own reads now.
 *  2. The entries that reach a SERVICE this process does not compose arrive as
 *     {@link ApiTrpcCollaborators}, named one by one, and their absence is a
 *     refusal to compose the record rather than a record whose procedures fail
 *     at first call.
 *
 * What did NOT change is the shape of a single port. Every signature here is
 * the one the feature package declared, because the client's types are derived
 * from them — the studio reads a stored version with the shape the row has,
 * and a port that answered `unknown` would hand the pages `unknown`.
 */
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ZodTypeAny } from "zod";
import type { ApiAuditPort } from "../api-request.policy";
import type { ApiTrpcFeatureMount } from "../api.application";
import type { ApiTrpcCollaborators } from "../app-trpc/app-trpc.collaborators";
import type { ApiTrpcPortsContext } from "../app-trpc/app-trpc.context";

/** The process's own collaborators, beside the ones it receives. */
export type ApiTrpcPortsCompositionOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /**
   * The AuthZ service the REST doors already authorize through, so a
   * permission probe inside a resolver answers what the declared check on the
   * same procedure would have.
   */
  authz: AuthzService;
  /**
   * The audit trail. Absent on a process that composed no sink: the two
   * entries that write to it then record nothing, which is the same
   * degradation every other door on this process already has.
   */
  audit: ApiAuditPort | undefined;
  /** The one place a declaration is turned into the middleware that runs it. */
  mount: ApiTrpcFeatureMount;
}>;

/**
 * Builds the full ports object from this process's graph plus the collaborators
 * it received.
 *
 * Generic over the same parameter `createAppTrpcFeatures` is, and for the same
 * reason: the sign-up questionnaire's schema is what the client sees.
 */
export function createApiTrpcPorts<TSignUpDataSchema extends ZodTypeAny>(
  options: ApiTrpcPortsCompositionOptions & {
    collaborators: ApiTrpcCollaborators<TSignUpDataSchema>;
  },
) {
  const { prisma, authz, audit, mount, collaborators } = options;

  /** The caller of one request, as the row reads and probes below read it. */
  const actorId = (ctx: unknown): string => (ctx as ApiTrpcPortsContext).actor().id;

  /**
   * The same question the declared check on the procedure asked, asked again
   * inside a resolver for a project the INPUT did not name — a copy's target,
   * a related workflow's own project. Answered by the one AuthZ service this
   * process authorizes with, never a second.
   */
  const probeProjectPermission = (
    ctx: unknown,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<boolean> => authz.hasPermission({ userId: actorId(ctx), permission, projectId });

  return {
    auth: collaborators.auth,

    group: collaborators.group,

    identity: collaborators.identity,

    joinRequests: {
      ...collaborators.joinRequests,
      listUserNames: (_ctx: unknown, { userIds }: Readonly<{ userIds: readonly string[] }>) =>
        prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true },
        }),
    },

    onboarding: collaborators.onboarding,

    /**
     * The process's database client. One surface takes it directly: the
     * evaluation mount builds its custom-evaluator read on the client rather
     * than on a request context, because that read is the same table scan for
     * every caller.
     */
    prisma,

    /**
     * The user rows this connection answers, and the four it deliberately
     * does not.
     *
     * `Account` — the table a person's sign-in methods live on, and the table
     * the bcrypt password hash lives ON — is not read here at all any more.
     * Four entries used to be, one of them a `select` naming `password`. They
     * arrive through `collaborators.user` now, answered by the user feature's
     * own `UserCredentialService`, which compares a hash and discards it
     * rather than handing it out. `specs` state the invariant; the composition
     * test hands this function a client whose `account` delegate refuses every
     * access, and the four answers still come back.
     *
     * What is left is `User`, a different table with no credential on it.
     */
    user: {
      ...collaborators.user,

      emailIsTaken: async (_ctx: unknown, { email }: Readonly<{ email: string }>) =>
        (await prisma.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        })) !== null,

      isOrganizationMember: async (
        _ctx: unknown,
        { userId, organizationId }: Readonly<{ userId: string; organizationId: string }>,
      ) =>
        (await prisma.organizationUser.findUnique({
          where: { userId_organizationId: { userId, organizationId } },
        })) !== null,

      tryGetOrganizationName: async (
        _ctx: unknown,
        { organizationId }: Readonly<{ organizationId: string }>,
      ) =>
        (
          await prisma.organization.findUnique({
            where: { id: organizationId },
            select: { name: true },
          })
        )?.name ?? null,

      tryGetUserContact: (_ctx: unknown, { userId }: Readonly<{ userId: string }>) =>
        prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, name: true },
        }),

      tryFindFirstProjectSlug: async (
        _ctx: unknown,
        { organizationId, userId }: Readonly<{ organizationId: string; userId: string }>,
      ) =>
        (
          await prisma.project.findFirst({
            where: {
              team: { organizationId, members: { some: { userId } } },
              archivedAt: null,
            },
            orderBy: { createdAt: "asc" },
            select: { slug: true },
          })
        )?.slug ?? null,
    },
  };
}

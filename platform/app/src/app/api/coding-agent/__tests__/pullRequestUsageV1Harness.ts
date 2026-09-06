/**
 * Shared fixture for the v1 pull-request usage REST suites.
 *
 * One organization with two shared projects and a spread of credentials — a
 * full org-admin key, two deliberately narrowed keys, a service key, a legacy
 * project key — plus a second organization whose key must learn nothing here.
 * The App the suites read through is installed by
 * pullRequestUsageV1TestApp.ts.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import {
  type CleanupEntry,
  cleanupTestRows,
} from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";

export const USAGE_SPEC_PATH = "/api/v1/coding-agent/pull-request-usage";
export const USAGE_PATH = `${USAGE_SPEC_PATH}?repository=acme/widgets&pullRequest=1`;

export const bearer = ({ token }: { token: string }) => ({
  Authorization: `Bearer ${token}`,
});

export interface PullRequestUsageV1Fixture {
  organization: Organization;
  team: Team;
  callerUserId: string;
  /** Two shared projects the caller may view through the org-admin binding. */
  projectAId: string;
  projectBId: string;
  /** A user-bound key carrying an org-wide admin binding. */
  callerToken: string;
  /** The same holder's key, bound to project A alone. */
  narrowedToken: string;
  /** The same holder's key, bound to project A with a role that cannot price. */
  viewerToken: string;
  /** An organization service key created for no user, bound org-wide. */
  serviceToken: string;
  /** The id behind serviceToken, which the audit trail names the actor by. */
  serviceKeyId: string;
  /** A service key whose bindings grant viewing but never pricing. */
  serviceViewerToken: string;
  /** A service key bound to project A alone. */
  serviceProjectToken: string;
  /** A legacy project API key, carrying neither organization nor user. */
  legacyProjectKey: string;
  /** Another organization entirely, whose key must learn nothing here. */
  otherOrganization: Organization;
  otherOrgUserId: string;
  otherOrgToken: string;
}

const project = ({
  ns,
  name,
  teamId,
}: Record<"ns" | "name" | "teamId", string>) => ({
  id: `project_${nanoid()}`,
  name,
  slug: `--test-${name.toLowerCase().replaceAll(" ", "-")}-${ns}`,
  language: "typescript",
  framework: "other",
  apiKey: `sk-lw-${nanoid(48)}`,
  teamId,
  isPersonal: false,
  ownerUserId: null,
});

interface KeyBinding {
  role: TeamUserRole;
  scopeType: RoleBindingScopeType;
  scopeId: string;
}

const orgAdminBinding = (organizationId: string): KeyBinding => ({
  role: TeamUserRole.ADMIN,
  scopeType: RoleBindingScopeType.ORGANIZATION,
  scopeId: organizationId,
});

/** One admin user in an organization, with the role binding key minting reads. */
async function seedAdminUser({
  ns,
  label,
  organizationId,
}: Record<"ns" | "label" | "organizationId", string>): Promise<string> {
  const user = await prisma.user.create({
    data: { name: label, email: `${label}-${ns}@example.com` },
  });
  await prisma.organizationUser.create({
    data: {
      userId: user.id,
      organizationId,
      role: OrganizationUserRole.ADMIN,
    },
  });
  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId,
      userId: user.id,
      ...orgAdminBinding(organizationId),
    },
  });
  return user.id;
}

async function mintKey({
  ns,
  name,
  userId,
  organizationId,
  bindings,
}: {
  ns: string;
  name: string;
  userId: string | null;
  organizationId: string;
  bindings: KeyBinding[];
}): Promise<{ token: string; id: string }> {
  const created = await ApiKeyService.create(prisma).create({
    name: `${name}-${ns}`,
    userId,
    createdByUserId: userId,
    organizationId,
    permissionMode: "all",
    bindings,
  });
  return { token: created.token, id: created.apiKey.id };
}

export async function seedPullRequestUsageV1Fixture({
  ns,
}: {
  ns: string;
}): Promise<PullRequestUsageV1Fixture> {
  const organization = await prisma.organization.create({
    data: { name: `pr-usage-v1-${ns}`, slug: `--test-org-v1-${ns}` },
  });
  const team = await prisma.team.create({
    data: {
      name: `pr-usage-v1-${ns}`,
      slug: `--test-team-v1-${ns}`,
      organizationId: organization.id,
    },
  });
  const callerUserId = await seedAdminUser({
    ns,
    label: "caller-v1",
    organizationId: organization.id,
  });

  const projectA = await prisma.project.create({
    data: project({ ns, name: "Alpha", teamId: team.id }),
  });
  const projectB = await prisma.project.create({
    data: project({ ns, name: "Beta", teamId: team.id }),
  });

  await prisma.githubPullRequest.create({
    data: {
      organizationId: organization.id,
      repositoryHost: "github.com",
      repositoryFullName: "acme/widgets",
      headBranch: "feat/linkage",
      prNumber: 1,
      htmlUrl: "https://github.com/acme/widgets/pull/1",
      title: "Link sessions to pull requests",
      state: "open",
      isDraft: false,
      authorLogin: "acme-dev",
      prCreatedAt: new Date("2026-07-01T09:00:00Z"),
    },
  });

  const keyArgs = { ns, organizationId: organization.id };
  const otherOrganization = await prisma.organization.create({
    data: { name: `pr-usage-v1-other-${ns}`, slug: `--test-other-org-${ns}` },
  });
  const otherOrgUserId = await seedAdminUser({
    ns,
    label: "elsewhere-v1",
    organizationId: otherOrganization.id,
  });

  const projectBinding = (role: TeamUserRole): KeyBinding => ({
    role,
    scopeType: RoleBindingScopeType.PROJECT,
    scopeId: projectA.id,
  });
  const service = await mintKey({
    ...keyArgs,
    name: "pr-usage-v1-service",
    userId: null,
    bindings: [orgAdminBinding(organization.id)],
  });

  return {
    organization,
    team,
    callerUserId,
    projectAId: projectA.id,
    projectBId: projectB.id,
    callerToken: (
      await mintKey({
        ...keyArgs,
        name: "pr-usage-v1-caller",
        userId: callerUserId,
        bindings: [orgAdminBinding(organization.id)],
      })
    ).token,
    narrowedToken: (
      await mintKey({
        ...keyArgs,
        name: "pr-usage-v1-narrowed",
        userId: callerUserId,
        bindings: [projectBinding(TeamUserRole.ADMIN)],
      })
    ).token,
    viewerToken: (
      await mintKey({
        ...keyArgs,
        name: "pr-usage-v1-viewer",
        userId: callerUserId,
        bindings: [projectBinding(TeamUserRole.VIEWER)],
      })
    ).token,
    serviceToken: service.token,
    serviceKeyId: service.id,
    // Viewing without pricing, on both projects. Project-scoped VIEWER
    // bindings rather than one org-scoped VIEWER: a built-in role bound at
    // organization scope grants project-tier permissions only as ADMIN
    // (role-binding-resolver), so "may view, may not price" is a
    // project-scope grant by construction.
    serviceViewerToken: (
      await mintKey({
        ...keyArgs,
        name: "pr-usage-v1-service-viewer",
        userId: null,
        bindings: [
          projectBinding(TeamUserRole.VIEWER),
          {
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: projectB.id,
          },
        ],
      })
    ).token,
    serviceProjectToken: (
      await mintKey({
        ...keyArgs,
        name: "pr-usage-v1-service-project",
        userId: null,
        bindings: [projectBinding(TeamUserRole.ADMIN)],
      })
    ).token,
    legacyProjectKey: projectA.apiKey,
    otherOrganization,
    otherOrgUserId,
    otherOrgToken: (
      await mintKey({
        ns,
        name: "pr-usage-v1-other",
        userId: otherOrgUserId,
        organizationId: otherOrganization.id,
        bindings: [orgAdminBinding(otherOrganization.id)],
      })
    ).token,
  };
}

/**
 * Removes what the seed created. Guarded per identifier: a failed `beforeAll`
 * leaves some of them unassigned, and the cleanup must then skip their rows
 * rather than dereference undefined and mask the setup error.
 */
export async function cleanupPullRequestUsageV1Fixture(
  fixture: Partial<PullRequestUsageV1Fixture> | undefined,
): Promise<void> {
  const organizationIds = [
    fixture?.organization?.id,
    fixture?.otherOrganization?.id,
  ].filter((id): id is string => id !== undefined);
  const userIds = [fixture?.callerUserId, fixture?.otherOrgUserId].filter(
    (id): id is string => id !== undefined,
  );
  const teamId = fixture?.team?.id;

  // Bindings before keys: a key-scoped RoleBinding requires its ApiKey, so
  // deleting the key first is refused outright. Every entry names only rows
  // whose identifier the seed actually assigned.
  const entries: CleanupEntry[] = organizationIds.flatMap<CleanupEntry>(
    (organizationId) => [
      ["auditLog", { organizationId }],
      ["githubPullRequest", { organizationId }],
      ["roleBinding", { organizationId }],
      ["apiKey", { organizationId }],
      ["organizationUser", { organizationId }],
    ],
  );
  if (teamId) entries.push(["project", { teamId }]);
  if (userIds.length > 0) entries.push(["user", { id: { in: userIds } }]);
  if (teamId) entries.push(["team", { id: teamId }]);
  for (const id of organizationIds) entries.push(["organization", { id }]);

  await cleanupTestRows(prisma, entries);
}

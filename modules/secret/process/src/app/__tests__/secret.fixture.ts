import type { AuthzApi, AuthzTeamMemberBinding } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { MemorySecretRepositories } from "../../repositories/memory/memory.secret.repositories.ts";
import type { SecretRepositories } from "../../repositories/secret.repositories.ts";
import type { SecretEncryption } from "../secret.app.ts";
import { SecretModule } from "../secret.app.ts";

/**
 * A reversible stand-in for AES-GCM. It is not a cipher and does not pretend
 * to be one: what a service test needs from encryption is that what went in
 * comes back and that a ciphertext is not the plaintext.
 */
export class ReversibleTestSecretEncryption implements SecretEncryption {
  encrypt(value: string): string {
    return `encrypted(${value})`;
  }

  decrypt(value: string): string {
    return value.replace(/^encrypted\((.*)\)$/, "$1");
  }
}

const EPOCH = new Date("2026-08-24T00:00:00.000Z");

/** A project on team `team-1` of `organization-1`. */
function projectWithTeam(projectId: string): ProjectWithTeam {
  return {
    id: projectId,
    name: "Project",
    slug: projectId,
    apiKey: "sk-lw-project",
    lwqlKey: "lwql-project",
    teamId: "team-1",
    language: "python",
    framework: "openai",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: null,
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    team: {
      id: "team-1",
      name: "Team",
      slug: "team-1",
      organizationId: "organization-1",
      createdAt: EPOCH,
      updatedAt: EPOCH,
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      departmentId: null,
    },
  };
}

function teamMemberBinding(userId: string): AuthzTeamMemberBinding {
  return {
    userId,
    role: "ADMIN",
    customRoleId: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    user: { id: userId, name: null, email: null, image: null },
    customRole: null,
  };
}

export interface SecretTestPeers {
  projects: ProjectApi;
  permissions: AuthzApi;
}

/** Peers answering that every project's team has these members, in binding order. */
export function teamWithMembers(userIds: readonly string[]): SecretTestPeers {
  return {
    projects: createApiFixture<ProjectApi>({
      getWithTeam: async (id) => projectWithTeam(id),
    }),
    permissions: createApiFixture<AuthzApi>({
      listTeamMemberBindings: async ({ teamIds }) =>
        new Map(teamIds.map((teamId) => [teamId, userIds.map(teamMemberBinding)])),
    }),
  };
}

export function createSecretTestApp(
  input: Readonly<{
    repositories?: SecretRepositories;
    encryption?: SecretEncryption;
    peers?: SecretTestPeers;
  }> = {},
): SecretModule {
  return SecretModule.create({
    repositories: input.repositories ?? MemorySecretRepositories.create(),
    dependencies: input.peers ?? teamWithMembers([]),
    members: { encryption: input.encryption ?? new ReversibleTestSecretEncryption() },
    config: void 0,
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
}

import {
  projectSchema,
  projectWithTeamSchema,
  type Project,
  type ProjectWithTeam,
  type Team,
} from "@langwatch/project-contract";

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

/**
 * A complete project row, so a suite's double answers what the real directory
 * answers. A stub carrying five of the twenty-nine columns describes a
 * response no door ever sends, and the schema is what says so.
 */
export function testProject(overrides: Partial<Project> = {}): Project {
  return projectSchema.parse({
    id: "project-1",
    name: "Project",
    slug: "project",
    apiKey: "api-key",
    lwqlKey: "lwql-key",
    teamId: "team-1",
    language: "python",
    framework: "openai",
    kind: "application",
    firstMessage: false,
    integrated: true,
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
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    ...overrides,
  });
}

export function testTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "team-1",
    name: "Core",
    slug: "core",
    organizationId: "organization-1",
    createdAt: EPOCH,
    updatedAt: EPOCH,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
    ...overrides,
  };
}

/** The same row with the team the directory joins onto it. */
export function testProjectWithTeam(
  overrides: Partial<Project> = {},
  team: Partial<Team> = {},
): ProjectWithTeam {
  const project = testProject(overrides);

  return projectWithTeamSchema.parse({
    ...project,
    team: testTeam({ id: project.teamId, ...team }),
  });
}

import { describe, expect, it } from "vitest";

import { teamWithProjectsSchema } from "../team.responses.ts";

describe("teamWithProjectsSchema", () => {
  /** @scenario "The team reads return only the fields the pickers show" */
  it("carries each project's id, name and slug and nothing else", () => {
    const at = new Date("2026-09-30T00:00:00.000Z");
    const read = teamWithProjectsSchema.parse({
      id: "team_1",
      name: "Core",
      slug: "core",
      organizationId: "organization_1",
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      members: [],
      projects: [
        {
          id: "project_1",
          name: "Chat",
          slug: "chat",
          apiKey: "stored-key",
          lwqlKey: "stored-query-key",
          s3Endpoint: "https://storage.example.com",
          s3AccessKeyId: "stored-access",
          s3SecretAccessKey: "stored-secret",
          s3Bucket: "bucket",
        },
      ],
    });

    expect(read.projects).toEqual([{ id: "project_1", name: "Chat", slug: "chat" }]);
  });
});

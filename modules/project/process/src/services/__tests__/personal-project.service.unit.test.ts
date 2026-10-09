/**
 * @vitest-environment node
 * @see modules/project/specs/personal-project-lifecycle.feature
 */
import type { Project } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { MemoryProjectDatabase } from "../../repositories/memory/memory.project.database.ts";
import { MemoryProjectRepository } from "../../repositories/memory/memory.project.repository.ts";
import { PersonalProjectService } from "../personal-project.service.ts";

const at = new Date("2026-01-01T00:00:00.000Z");
const ALL_ON = { evaluations: true, datasets: true, annotations: true, automations: true };
const ALL_OFF = { evaluations: false, datasets: false, annotations: false, automations: false };

function project(input: {
  id: string;
  teamId: string;
  isPersonal: boolean;
  archivedAt?: Date | null;
}): Project {
  return {
    id: input.id,
    name: input.id,
    slug: input.id,
    apiKey: `sk-${input.id}`,
    lwqlKey: `lwql-${input.id}`,
    teamId: input.teamId,
    language: "other",
    framework: "other",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: at,
    updatedAt: at,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: input.archivedAt ?? null,
    isPersonal: input.isPersonal,
    ownerUserId: input.isPersonal ? "user-1" : null,
    personalFeatures: ALL_OFF,
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    aggregateRule: null,
  };
}

function setup(...rows: Project[]) {
  const memory = MemoryProjectDatabase.create();
  for (const row of rows) memory.putProject(row);
  const revived: { projectId: string; organizationId: string }[] = [];
  const service = PersonalProjectService.create({
    projects: MemoryProjectRepository.create({ memory }),
    lifecycle: { revived: async (input) => void revived.push(input) },
  });
  return { service, revived, row: (id: string) => memory.findProject(id) };
}

describe("PersonalProjectService", () => {
  /** @scenario "A removed member's personal project is archived with their personal team" */
  it("archives the personal project in the archived team and leaves a shared one live", async () => {
    const { service, row } = setup(
      project({ id: "personal", teamId: "team-personal", isPersonal: true }),
      project({ id: "shared", teamId: "team-shared", isPersonal: false }),
    );

    await service.archive({ teamIds: ["team-personal", "team-shared"], occurredAt: 1_000 });

    expect(row("personal")?.archivedAt?.getTime()).toBe(1_000);
    expect(row("shared")?.archivedAt).toBeNull();
  });

  /** @scenario "An archive delivered twice keeps the first archive time" */
  it("keeps the first archive time when the fact is delivered again", async () => {
    const { service, row } = setup(
      project({ id: "personal", teamId: "team-personal", isPersonal: true }),
    );

    await service.archive({ teamIds: ["team-personal"], occurredAt: 1_000 });
    await service.archive({ teamIds: ["team-personal"], occurredAt: 2_000 });

    expect(row("personal")?.archivedAt?.getTime()).toBe(1_000);
  });

  /** @scenario "A revived personal team revives its personal project" */
  it("revives the archived personal project in the revived team", async () => {
    const { service, row, revived } = setup(
      project({ id: "personal", teamId: "team-personal", isPersonal: true, archivedAt: at }),
    );

    await service.revive({ teamId: "team-personal", organizationId: "org_acme" });
    await service.revive({ teamId: "team-personal", organizationId: "org_acme" });

    expect(row("personal")?.archivedAt).toBeNull();
    expect(revived).toEqual([{ projectId: "personal", organizationId: "org_acme" }]);
  });

  /** @scenario "A personal workspace's feature switches land on its personal project" */
  it("stores the switches on the personal project", async () => {
    const { service, row } = setup(
      project({ id: "personal", teamId: "team-personal", isPersonal: true }),
    );

    await service.setFeatures({ projectId: "personal", features: ALL_ON });

    expect(row("personal")?.personalFeatures).toEqual(ALL_ON);
  });

  /** @scenario "Feature switches never land on a shared project" */
  it("leaves a shared project's switches unchanged", async () => {
    const { service, row } = setup(
      project({ id: "shared", teamId: "team-shared", isPersonal: false }),
    );

    await service.setFeatures({ projectId: "shared", features: ALL_ON });

    expect(row("shared")?.personalFeatures).toEqual(ALL_OFF);
  });
});

describe("creating a personal team's personal project", () => {
  const fact = {
    teamId: "team-p",
    projectId: "project-p",
    projectSlug: "personal-p",
    userId: "user-1",
  };

  /** @scenario "A personal team's fact creates its personal project with a key project mints" */
  it("creates the project under the fact's id and slug with a key in the pkey_ format", async () => {
    const { service, row } = setup();

    await service.create(fact);

    expect(row("project-p")).toMatchObject({
      teamId: "team-p",
      slug: "personal-p",
      name: "Personal Workspace",
      isPersonal: true,
      ownerUserId: "user-1",
    });
    expect(row("project-p")?.apiKey).toMatch(/^pkey_[A-Za-z0-9_-]{40}$/);
  });

  /** @scenario "A personal team's fact delivered twice creates one personal project" */
  it("creates nothing on a redelivery and keeps the first key", async () => {
    const { service, row } = setup();
    await service.create(fact);
    const firstKey = row("project-p")?.apiKey;

    await service.create(fact);

    expect(row("project-p")?.apiKey).toBe(firstKey);
  });
});

/**
 * ADR-175: an aggregate's stored rule is read through the schema, never a cast.
 * A column that does not parse is unreadable; a row carrying it is still a project.
 * @see specs/governance/aggregate-project.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { aggregateRuleFromDb } from "../prisma.project.mapper.ts";
import { PrismaProjectRepository } from "../prisma.project.repository.ts";

describe("aggregateRuleFromDb", () => {
  describe("when the stored column holds a valid rule", () => {
    it("returns each rule kind as stored", () => {
      for (const rule of [
        { kind: "all-personal" },
        { kind: "personal-by-department", departmentId: "dep_eng" },
        { kind: "explicit", projectIds: ["p_1", "p_2"] },
      ]) {
        expect(aggregateRuleFromDb(rule)).toEqual({ outcome: "rule", rule });
      }
    });
  });

  describe("when the stored column is malformed", () => {
    it.each([
      ["an unknown kind", { kind: "everything" }],
      ["an explicit rule with no projects", { kind: "explicit", projectIds: [] }],
      ["a department rule with no department", { kind: "personal-by-department" }],
      ["an extra field", { kind: "all-personal", where: "x" }],
      ["a string", "all-personal"],
      ["an array", [{ kind: "all-personal" }]],
    ])("reads %s as unreadable", (_label, stored) => {
      expect(aggregateRuleFromDb(stored)).toEqual({ outcome: "unreadable" });
    });
  });

  describe("when the stored column is empty", () => {
    it("reads null and undefined as unreadable", () => {
      expect(aggregateRuleFromDb(null)).toEqual({ outcome: "unreadable" });
      expect(aggregateRuleFromDb(void 0)).toEqual({ outcome: "unreadable" });
    });
  });
});

describe("given a project row that carries the aggregate rule column", () => {
  const NOW = new Date("2026-10-06T00:00:00.000Z");
  const row = {
    id: "project_aggregate",
    name: "Company view",
    slug: "company-view",
    apiKey: "sk-lw-unused",
    lwqlKey: "lwql-unused",
    teamId: "team_1",
    language: "other",
    framework: "other",
    kind: "aggregate",
    firstMessage: false,
    integrated: false,
    createdAt: NOW,
    updatedAt: NOW,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: true,
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
    aggregateRule: { kind: "all-personal" },
  };

  it("reads it as a project, keeping the stored rule", async () => {
    const project = { findUnique: vi.fn(async () => row) };
    const repository = PrismaProjectRepository.create({ prisma: prismaDouble({ project }) });

    await expect(repository.findById(row.id)).resolves.toMatchObject({
      id: row.id,
      kind: "aggregate",
      aggregateRule: { kind: "all-personal" },
    });
  });
});

/**
 * Slack connection storage against a real database: the claims here are about
 * rows and the tenancy regime (an org-scoped model outside every regime makes
 * each query throw, which a mock cannot notice), the per-scope fingerprint
 * unique index, and counting automations across an organization's projects.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type Organization,
  type Project,
  type Team,
  TriggerAction,
  TriggerKind,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { PrismaSlackIntegrationRepository } from "../repositories/slack-integration.prisma.repository";
import type { SlackConnectionRecord } from "../repositories/slack-integration.repository";

describe("Feature: Slack connections storage", () => {
  const ns = `slackconn-${nanoid(8)}`;

  let organization: Organization | undefined;
  let team: Team | undefined;
  let project: Project | undefined;
  let otherProject: Project | undefined;
  let repo: PrismaSlackIntegrationRepository;

  const orgId = () => organization!.id;

  const record = (
    overrides: Partial<SlackConnectionRecord>,
  ): SlackConnectionRecord => ({
    name: "Connection",
    kind: "INCOMING_WEBHOOK",
    scopeType: "PROJECT",
    scopeId: project!.id,
    organizationId: orgId(),
    botTokenEncrypted: null,
    webhookUrlEncrypted: "enc",
    secretFingerprint: `fp-${nanoid(6)}`,
    secretHint: "abcd",
    slackTeamId: null,
    slackTeamName: null,
    ...overrides,
  });

  const storeSlackAutomation = ({
    projectId,
    slackIntegrationId,
    active = true,
  }: {
    projectId: string;
    slackIntegrationId: string;
    active?: boolean;
  }) =>
    prisma.trigger.create({
      data: {
        id: nanoid(),
        name: `Slack automation ${nanoid(4)}`,
        projectId,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        active,
        actionParams: { slackIntegrationId, slackDelivery: "webhook" },
        filters: {},
        triggerKind: TriggerKind.AUTOMATION,
      },
    });

  const createProject = (suffix: string) =>
    prisma.project.create({
      data: {
        name: `Slack Project ${suffix}`,
        slug: `--test-project-${ns}-${suffix}`,
        teamId: team!.id,
        language: "other",
        framework: "other",
        apiKey: `test-api-key-${ns}-${suffix}`,
      },
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Slack Connections Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Slack Connections Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await createProject("a");
    otherProject = await createProject("b");
    repo = new PrismaSlackIntegrationRepository(prisma);
  });

  beforeEach(async () => {
    if (!organization || !project || !otherProject) return;
    await prisma.trigger.deleteMany({
      where: { projectId: { in: [project.id, otherProject.id] } },
    });
    await prisma.slackIntegration.deleteMany({
      where: { organizationId: organization.id },
    });
  });

  afterAll(async () => {
    if (organization) {
      await prisma.slackIntegration.deleteMany({
        where: { organizationId: organization.id },
      });
    }
    for (const each of [project, otherProject]) {
      if (!each) continue;
      await prisma.trigger.deleteMany({ where: { projectId: each.id } });
      await prisma.project.delete({ where: { id: each.id } });
    }
    if (team) await prisma.team.delete({ where: { id: team.id } });
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });

  describe("given organization, project and other-project connections", () => {
    /** @scenario "A project lists its own connections and its organization's" */
    it("lists the organization's and the project's own, not the other project's", async () => {
      await repo.create({
        record: record({
          name: "B org",
          scopeType: "ORGANIZATION",
          scopeId: orgId(),
        }),
        actorId: "user-1",
      });
      await repo.create({
        record: record({ name: "A project" }),
        actorId: "user-1",
      });
      await repo.create({
        record: record({ name: "Other", scopeId: otherProject!.id }),
        actorId: "user-1",
      });

      const listed = await repo.findAllUsableByProject({
        organizationId: orgId(),
        projectId: project!.id,
      });

      expect(listed.map((row) => row.name)).toEqual(["A project", "B org"]);
    });
  });

  describe("given a fingerprint the scope already holds", () => {
    it("create answers null instead of storing a second copy", async () => {
      await repo.create({
        record: record({ secretFingerprint: "same" }),
        actorId: "user-1",
      });

      const second = await repo.create({
        record: record({ secretFingerprint: "same", name: "Copy" }),
        actorId: "user-1",
      });

      expect(second).toBeNull();
      await expect(
        repo.findAllByFingerprint({
          organizationId: orgId(),
          secretFingerprint: "same",
          scopes: [{ scopeType: "PROJECT", scopeId: project!.id }],
        }),
      ).resolves.toEqual([expect.objectContaining({ name: "Connection" })]);
    });
  });

  describe("given one fingerprint held in several scopes", () => {
    it("stores one copy per scope and reads only the scopes asked for", async () => {
      const scopes: Pick<SlackConnectionRecord, "scopeType" | "scopeId">[] = [
        { scopeType: "ORGANIZATION", scopeId: orgId() },
        { scopeType: "PROJECT", scopeId: project!.id },
        { scopeType: "PROJECT", scopeId: otherProject!.id },
      ];
      for (const scope of scopes) {
        const stored = await repo.create({
          record: record({ ...scope, secretFingerprint: "shared" }),
          actorId: "user-1",
        });
        expect(stored).not.toBeNull();
      }

      const reachable = await repo.findAllByFingerprint({
        organizationId: orgId(),
        secretFingerprint: "shared",
        scopes: scopes.slice(0, 2),
      });

      expect(reachable.map((row) => row.scopeId).sort()).toEqual(
        [orgId(), project!.id].sort(),
      );
    });
  });

  describe("given automations across the organization's projects", () => {
    it("counts only active ones pointing at each connection", async () => {
      const shared = await repo.create({
        record: record({ scopeType: "ORGANIZATION", scopeId: orgId() }),
        actorId: "user-1",
      });
      const id = shared!.id;
      await storeSlackAutomation({
        projectId: project!.id,
        slackIntegrationId: id,
      });
      await storeSlackAutomation({
        projectId: otherProject!.id,
        slackIntegrationId: id,
      });
      await storeSlackAutomation({
        projectId: project!.id,
        slackIntegrationId: id,
        active: false,
      });

      const counts = await repo.countDependentAutomations({
        organizationId: orgId(),
        ids: [id],
      });

      expect(counts.get(id)).toBe(2);
    });
  });

  describe("update and delete", () => {
    it("are bounded by the organization", async () => {
      const row = await repo.create({ record: record({}), actorId: "user-1" });
      const id = row!.id;

      await repo.update({
        id,
        organizationId: orgId(),
        changes: { name: "Renamed" },
        actorId: "user-2",
      });
      await repo.delete({ id, organizationId: "another-org" });

      await expect(repo.findById({ id })).resolves.toMatchObject({
        name: "Renamed",
        updatedById: "user-2",
      });

      await repo.delete({ id, organizationId: orgId() });
      await expect(repo.findById({ id })).resolves.toBeNull();
    });
  });
});

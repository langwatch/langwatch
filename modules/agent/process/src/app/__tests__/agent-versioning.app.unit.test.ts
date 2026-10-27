import type { AuditLogApi, AuditLogHistoryEntry } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryAgentRepositories } from "../../repositories/memory/memory.agent.repositories.ts";
import { MemoryAgentRepository } from "../../repositories/memory/memory.agent.repository.ts";
import { AgentVersionService } from "../../services/agent-version.service.ts";
import { agentFixture, createAgentAppFixture } from "./agent.fixture.ts";

const projectId = "project_1";
const ada = { type: "user", id: "user_ada" } as const;
const grace = { type: "user", id: "user_grace" } as const;

function profile(id: string, name: string) {
  return {
    id,
    name,
    email: `${name.toLowerCase()}@example.com`,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
  };
}

function setup(options: { canDeploy?: boolean; history?: AuditLogHistoryEntry[] } = {}) {
  const people = [profile("user_ada", "Ada"), profile("user_grace", "Grace")];
  const dependencies = {
    users: createApiFixture<UserApi>({
      getProfiles: async ({ userIds }) => people.filter((person) => userIds.includes(person.id)),
    }),
    permissions: createApiFixture<AuthzApi>({
      getScope: async () => ({ type: "project", id: projectId }) as never,
      can: async ({ permission }) => permission === "agents:deploy" && options.canDeploy === true,
    }),
    auditLog: createApiFixture<AuditLogApi>({
      listEntityHistory: async ({ actionPrefix }) =>
        (options.history ?? []).filter((entry) => entry.action.startsWith(actionPrefix)),
    }),
  };
  const agents = MemoryAgentRepository.create();
  const fixture = createAgentAppFixture({
    ...dependencies,
    repositories: { ...MemoryAgentRepositories.create(), agents },
  });
  const checkpoints: unknown[] = [];
  const backfill = (input: { dryRun: boolean }) =>
    AgentVersionService.create({
      repository: fixture.repositories.agents,
      ...dependencies,
    }).backfill({
      dryRun: input.dryRun,
      signal: new AbortController().signal,
      afterId: null,
      onPage: async (report) => {
        checkpoints.push(report);
      },
    });
  return { ...fixture, agents, backfill, checkpoints };
}

async function agentWithVersions(
  app: ReturnType<typeof setup>["app"],
  count: number,
  id = "agent_1",
) {
  await app.create({
    id,
    projectId,
    name: "Support bot",
    type: "signature",
    config: { prompt: "v1" },
    caller: ada,
  });
  for (let version = 2; version <= count; version += 1) {
    await app.update({ id, projectId, config: { prompt: `v${version}` }, caller: ada });
  }
}

function promptOf(agent: { config: unknown }): unknown {
  return (agent.config as { prompt?: unknown }).prompt;
}

describe("agent versions", () => {
  /** @scenario "Creating an agent records version 1" */
  it("records version 1 authored by the creating user", async () => {
    const { app } = setup();
    await agentWithVersions(app, 1);

    const { versions } = await app.listVersions({ projectId, agentId: "agent_1" });
    expect(versions.map((row) => [row.version, row.authorId, row.authorKind])).toEqual([
      [1, "user_ada", "user"],
    ]);
    const agent = await app.getById({ id: "agent_1", projectId });
    expect(agent.createdBy).toEqual({ id: "user_ada", name: "Ada" });
    expect(agent.updatedBy).toEqual({ id: "user_ada", name: "Ada" });
    expect(agent.version).toBe(1);
  });

  /** @scenario "Every update appends a version and keeps the head as latest" */
  it("appends a version per update and reads the newest by default", async () => {
    const { app } = setup();
    await agentWithVersions(app, 1);
    await app.update({
      id: "agent_1",
      projectId,
      config: { prompt: "v2" },
      commitMessage: "Use the new endpoint",
      caller: ada,
    });

    const { versions } = await app.listVersions({ projectId, agentId: "agent_1" });
    expect(versions.map((row) => row.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({
      commitMessage: "Use the new endpoint",
      authorId: "user_ada",
      config: { prompt: "v2" },
    });
    expect(versions[1]!.config).toMatchObject({ prompt: "v1" });
    const latest = await app.getById({ id: "agent_1", projectId });
    expect(promptOf(latest)).toBe("v2");
    expect(latest.version).toBe(2);
  });

  /** @scenario "An update by an API key records the key as the author kind" */
  it("records an API key update with no user", async () => {
    const { app } = setup();
    await agentWithVersions(app, 1);
    await app.update({
      id: "agent_1",
      projectId,
      name: "Renamed",
      caller: { type: "api_key", id: "key_1" },
    });

    const [newest] = (await app.listVersions({ projectId, agentId: "agent_1" })).versions;
    expect(newest).toMatchObject({ version: 2, authorId: null, authorKind: "api_key" });
    const agent = await app.getById({ id: "agent_1", projectId });
    expect(agent.createdBy).toEqual({ id: "user_ada", name: "Ada" });
    expect(agent.updatedBy).toBeNull();
  });

  /** @scenario "Connected agents are not versioned" */
  it("lists no versions for a connected agent and refuses a label on it", async () => {
    const { app } = setup({ canDeploy: true });
    await app.registerConnected({
      id: "agent_connected",
      projectId,
      name: "support-agent",
      config: { sdk: { name: "langwatch", version: "1.0.0", language: "python" }, parameters: [] },
      identity: {
        environment: "production",
        ownerUserId: null,
        hostLabel: null,
        identityKey: "support-agent@production",
      },
    });

    expect((await app.listVersions({ projectId, agentId: "agent_connected" })).versions).toEqual(
      [],
    );
    await expect(
      app.assignLabel({ projectId, agentId: "agent_connected", label: "production", version: 1 }),
    ).rejects.toMatchObject({ code: "agent_version_unsupported" });
  });
});

describe("agent deploy labels", () => {
  /** @scenario "Deploying a label points it at a version" */
  it("reads the agent at the label and at a version", async () => {
    const { app } = setup({ canDeploy: true });
    await agentWithVersions(app, 3);
    await app.assignLabel({ projectId, agentId: "agent_1", label: "production", version: 2 });

    const atLabel = await app.getById({ id: "agent_1", projectId, label: "production" });
    expect([promptOf(atLabel), atLabel.version]).toEqual(["v2", 2]);
    const atVersion = await app.getById({ id: "agent_1", projectId, version: 3 });
    expect([promptOf(atVersion), atVersion.version]).toEqual(["v3", 3]);
    const { versions } = await app.listVersions({ projectId, agentId: "agent_1" });
    expect(versions.find((row) => row.version === 2)!.labels).toEqual(["production"]);
  });

  /** @scenario "Moving a label repoints it" */
  it("repoints a label and records who moved it", async () => {
    const { app } = setup({ canDeploy: true });
    await agentWithVersions(app, 3);
    await app.assignLabel({ projectId, agentId: "agent_1", label: "production", version: 2 });
    const moved = await app.assignLabel({
      projectId,
      agentId: "agent_1",
      label: "production",
      version: 3,
      caller: grace,
    });

    expect(moved).toMatchObject({ version: 3, updatedById: "user_grace" });
    expect((await app.getById({ id: "agent_1", projectId, label: "production" })).version).toBe(3);
  });

  /** @scenario "Removing a label falls back to nothing, not to latest" */
  it("refuses a read at a removed label", async () => {
    const { app } = setup();
    await agentWithVersions(app, 2);
    await app.assignLabel({ projectId, agentId: "agent_1", label: "staging", version: 2 });
    await app.removeLabel({ projectId, agentId: "agent_1", label: "staging" });

    await expect(app.getById({ id: "agent_1", projectId, label: "staging" })).rejects.toMatchObject(
      { code: "agent_version_not_found" },
    );
  });

  /** @scenario "Label names follow the prompt tag rules" */
  it.each(["latest", "42", "Production", "-canary"])("refuses the label %s", async (label) => {
    const { app } = setup();
    await agentWithVersions(app, 2);

    await expect(
      app.assignLabel({ projectId, agentId: "agent_1", label, version: 1 }),
    ).rejects.toMatchObject({ code: "agent_label_invalid" });
  });

  /** @scenario "A label cannot point at a version of another agent" */
  it("refuses a version the agent does not have", async () => {
    const { app } = setup();
    await agentWithVersions(app, 1, "agent_1");
    await agentWithVersions(app, 3, "agent_2");

    await expect(
      app.assignLabel({ projectId, agentId: "agent_1", label: "production", version: 3 }),
    ).rejects.toMatchObject({ code: "agent_version_not_found" });
  });

  /** @scenario "Asking for a label and a version at once is refused" */
  it("refuses a label and a version together", async () => {
    const { app } = setup();
    await agentWithVersions(app, 2);

    await expect(
      app.getById({ id: "agent_1", projectId, label: "production", version: 1 }),
    ).rejects.toMatchObject({ code: "agent_version_selector_conflict" });
    await expect(
      app.getById({ id: "agent_1:production", projectId, version: 1 }),
    ).rejects.toMatchObject({ code: "agent_version_selector_conflict" });
  });

  /** @scenario "The id shorthand picks a label or a version" */
  it("reads the id:label, id:version and id:latest addresses", async () => {
    const { app } = setup();
    await agentWithVersions(app, 3);
    await app.assignLabel({ projectId, agentId: "agent_1", label: "production", version: 2 });

    expect((await app.getById({ id: "agent_1:production", projectId })).version).toBe(2);
    expect((await app.getById({ id: "agent_1:3", projectId })).version).toBe(3);
    const latest = await app.getById({ id: "agent_1:latest", projectId });
    expect([latest.id, latest.version]).toEqual(["agent_1", 3]);
  });
});

describe("archiving a deployed agent", () => {
  /** @scenario "Archiving a labelled agent needs the deploy permission" */
  it("refuses a caller without agents:deploy and keeps the agent", async () => {
    const { app } = setup({ canDeploy: false });
    await agentWithVersions(app, 2);
    await app.assignLabel({ projectId, agentId: "agent_1", label: "production", version: 2 });

    await expect(app.archive({ id: "agent_1", projectId, caller: grace })).rejects.toMatchObject({
      code: "agent_deployed_label_protected",
      meta: { labels: ["production"] },
    });
    expect((await app.getById({ id: "agent_1", projectId })).archivedAt).toBeNull();
  });

  /** @scenario "Archiving an unlabelled agent needs no deploy permission" */
  it("archives an unlabelled agent for a caller without agents:deploy", async () => {
    const { app } = setup({ canDeploy: false });
    await agentWithVersions(app, 1);

    const archived = await app.archive({ id: "agent_1", projectId, caller: grace });
    expect(archived.archivedAt).not.toBeNull();
  });

  /** @scenario "A caller with the deploy permission archives a labelled agent" */
  it("archives a labelled agent for a caller holding agents:deploy", async () => {
    const { app } = setup({ canDeploy: true });
    await agentWithVersions(app, 2);
    await app.assignLabel({ projectId, agentId: "agent_1", label: "production", version: 2 });

    const archived = await app.archive({ id: "agent_1", projectId, caller: grace });
    expect(archived.archivedAt).not.toBeNull();
  });
});

describe("the agent:backfill-versions step", () => {
  const history: AuditLogHistoryEntry[] = [
    {
      id: "entry_create",
      action: "agents.create",
      createdAt: new Date("2026-01-01"),
      userId: "user_ada",
      args: { id: "agent_old" },
    } as AuditLogHistoryEntry,
  ];

  /** @scenario "Existing agents get version 1 from their current config" */
  it("writes version 1 with the audit-log creator, once", async () => {
    const fixture = setup({ history });
    fixture.agents.seedUnversioned(
      agentFixture({ id: "agent_old", projectId, config: { prompt: "current" } }),
    );
    const { app, backfill } = fixture;

    expect((await backfill({ dryRun: false })).written).toBe(1);
    const { versions } = await app.listVersions({ projectId, agentId: "agent_old" });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version: 1,
      authorId: "user_ada",
      config: { prompt: "current" },
    });
    expect((await app.getById({ id: "agent_old", projectId })).createdBy).toEqual({
      id: "user_ada",
      name: "Ada",
    });
    expect((await backfill({ dryRun: false })).written).toBe(0);
  });

  /** @scenario "The backfill dry run writes nothing" */
  it("writes no version and saves no checkpoint on a dry run", async () => {
    const { app, agents, backfill, checkpoints } = setup({ history });
    agents.seedUnversioned(agentFixture({ id: "agent_old", projectId }));

    const report = await backfill({ dryRun: true });
    expect(report).toMatchObject({ written: 0, wouldWrite: 1 });
    expect(checkpoints).toEqual([]);
    expect((await app.listVersions({ projectId, agentId: "agent_old" })).versions).toEqual([]);
  });
});

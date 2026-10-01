import type { AgentApi, AgentOverview } from "@langwatch/agent-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Workflow, WorkflowVersion } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { WorkflowHttpSecretsService } from "../../services/workflow-http-secrets.service.ts";
import { WorkflowHttpCredentialsBackfillTask } from "../workflow-http-credentials-backfill.task.ts";

const TOKEN = "tok_live_old_123";
const at = new Date(0);

const node = (id: string, token: string) => ({
  id,
  type: "http",
  data: {
    name: "Partner API",
    parameters: [
      { identifier: "auth_type", type: "str", value: "bearer" },
      { identifier: "auth_token", type: "str", value: token },
    ],
  },
});

const versionOf = (id: string, nodes: unknown[]): WorkflowVersion => ({
  id,
  workflowId: "wf-1",
  projectId: "project-1",
  version: "1",
  autoSaved: false,
  commitMessage: "first",
  authorId: null,
  parentId: null,
  dsl: { version: "1", name: "Flow", nodes, edges: [] } as unknown as WorkflowVersion["dsl"],
  createdAt: at,
  updatedAt: at,
});

type VersionWrite = { id: string; projectId: string; dsl: unknown; updatedAt: Date };

type SecretRow = Awaited<ReturnType<SecretApi["create"]>>;

function build(
  options: {
    limit?: number;
    changedSinceRead?: boolean;
    secrets?: Record<string, string>;
    latestNodes?: unknown[];
    publishedNodes?: unknown[];
  } = {},
) {
  const secrets: Record<string, string> = { ...options.secrets };
  const rewritten: VersionWrite[] = [];
  const attempted: VersionWrite[] = [];
  const agentUpdates: unknown[] = [];
  const latest = versionOf("v-latest", options.latestNodes ?? [node("n1", TOKEN)]);
  const published = versionOf("v-published", options.publishedNodes ?? [node("n1", TOKEN)]);
  const rowOf = (name: string) =>
    createApiFixture<SecretRow>({ id: `id-${name}`, name });
  const secretApi = createApiFixture<SecretApi>({
    getValues: async () => ({ ...secrets }),
    create: async (input) => {
      if (Object.keys(secrets).length >= (options.limit ?? 50)) throw new Error("secret limit");
      secrets[input.name] = input.value;

      return rowOf(input.name);
    },
  });
  const task = WorkflowHttpCredentialsBackfillTask.create({
    organizations: createApiFixture<OrganizationApi>({ findAllIds: async () => ["org-1"] }),
    projects: createApiFixture<ProjectApi>({ listIdsByOrganization: async () => ["project-1"] }),
    agents: createApiFixture<Pick<AgentApi, "getAll" | "update">>({
      getAll: async () => [
        createApiFixture<AgentOverview>({
          id: "agent-1",
          type: "http",
          config: {
            url: "https://a.example",
            method: "POST",
            auth: { type: "bearer", token: TOKEN },
          },
        }),
        createApiFixture<AgentOverview>({
          id: "agent-2",
          type: "http",
          config: {
            url: "https://b.example",
            method: "POST",
            auth: { type: "bearer", token: "{{ secrets.ALREADY }}" },
          },
        }),
      ],
      update: async (input) => {
        agentUpdates.push(input);

        return createApiFixture({});
      },
    }),
    workflows: {
      findAll: async () => [createApiFixture<Workflow>({ id: "wf-1" })],
      findById: async () => ({
        ...createApiFixture<Workflow>({ id: "wf-1" }),
        latestVersion: latest,
        currentVersion: latest,
      }),
      findPublishedVersion: async () => published,
      updateVersionDslIfUnchanged: async (input) => {
        attempted.push(input);
        if (options.changedSinceRead) return false;
        rewritten.push(input);

        return true;
      },
    },
    httpSecrets: WorkflowHttpSecretsService.create(secretApi),
  });

  return { task, secrets, rewritten, attempted, agentUpdates };
}

const run = (task: WorkflowHttpCredentialsBackfillTask) =>
  task.run({ args: [], signal: new AbortController().signal });

describe("moving credentials typed inline before they became project secrets", () => {
  /** @scenario Credentials typed inline before this change are moved to project secrets */
  it("rewrites the latest and the published version with references, storing the token once", async () => {
    const { task, secrets, rewritten } = build();

    await run(task);

    expect(rewritten.map((version) => version.id).sort()).toEqual(["v-latest", "v-published"]);
    expect(JSON.stringify(rewritten)).not.toContain(TOKEN);
    expect(JSON.stringify(rewritten)).toContain("{{ secrets.HTTP_PARTNER_API_AUTH_TOKEN }}");
    expect(secrets).toEqual({ HTTP_PARTNER_API_AUTH_TOKEN: TOKEN });
  });

  /** @scenario Credentials typed inline before this change are moved to project secrets */
  it("updates only the agents that still hold a literal", async () => {
    const { task, agentUpdates } = build();

    await run(task);

    expect(agentUpdates).toHaveLength(1);
    expect(agentUpdates[0]).toMatchObject({ id: "agent-1", projectId: "project-1" });
  });

  /** @scenario Credentials typed inline before this change are moved to project secrets */
  it("leaves a node whose secret cannot be stored, and rewrites nothing for it", async () => {
    const { task, rewritten, secrets } = build({ limit: 0 });

    await run(task);

    expect(rewritten).toEqual([]);
    expect(secrets).toEqual({});
  });

  /** @scenario A version saved while the backfill runs keeps that save */
  it("writes only a version unchanged since it was read, and skips one saved in between", async () => {
    const { task, attempted, rewritten } = build({ changedSinceRead: true });

    await run(task);

    expect(attempted.map((write) => write.updatedAt)).toEqual([at, at]);
    expect(rewritten).toEqual([]);
  });
});

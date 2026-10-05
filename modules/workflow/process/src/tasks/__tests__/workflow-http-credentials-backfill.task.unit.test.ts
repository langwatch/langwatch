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
    projectIds?: string[];
  } = {},
) {
  const secrets: Record<string, string> = { ...options.secrets };
  const rewritten: VersionWrite[] = [];
  const attempted: VersionWrite[] = [];
  const walked: string[] = [];
  const latest = versionOf("v-latest", options.latestNodes ?? [node("n1", TOKEN)]);
  const published = versionOf("v-published", options.publishedNodes ?? [node("n1", TOKEN)]);
  const rowOf = (name: string) => createApiFixture<SecretRow>({ id: `id-${name}`, name });
  const secretApi = createApiFixture<SecretApi>({
    list: async () => Object.keys(secrets).map(rowOf),
    getValuesByName: async ({ names }) =>
      Object.fromEntries(Object.entries(secrets).filter(([name]) => names.includes(name))),
    create: async (input) => {
      if (Object.keys(secrets).length >= (options.limit ?? 50)) throw new Error("secret limit");
      secrets[input.name] = input.value;

      return rowOf(input.name);
    },
  });
  const task = WorkflowHttpCredentialsBackfillTask.create({
    workflows: {
      findProjectIds: async () => options.projectIds ?? ["project-1"],
      findAll: async ({ projectId }) => {
        walked.push(projectId);

        return [createApiFixture<Workflow>({ id: "wf-1" })];
      },
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

  return { task, secrets, rewritten, attempted, walked };
}

const run = (task: WorkflowHttpCredentialsBackfillTask) =>
  task.run({ args: [], signal: new AbortController().signal });

describe("moving credentials typed inline before they became project secrets", () => {
  /** @scenario Credentials typed inline before this change are moved to project secrets */
  it("rewrites the latest and the published version with references, storing the token once", async () => {
    const { task, secrets, rewritten } = build();

    await run(task);

    expect(rewritten.map((version) => version.id).toSorted()).toEqual(["v-latest", "v-published"]);
    expect(JSON.stringify(rewritten)).not.toContain(TOKEN);
    expect(JSON.stringify(rewritten)).toContain("{{ secrets.HTTP_PARTNER_API_AUTH_TOKEN }}");
    expect(secrets).toEqual({ HTTP_PARTNER_API_AUTH_TOKEN: TOKEN });
  });

  /** @scenario Credentials typed inline before this change are moved to project secrets */
  it("walks every project its own workflow rows name", async () => {
    const { task, walked } = build({ projectIds: ["project-1", "project-2"] });

    await run(task);

    expect(walked).toEqual(["project-1", "project-2"]);
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

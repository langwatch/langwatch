import type { SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Workflow, WorkflowVersion } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  WorkflowHttpCredentialsBackfillService,
  type WorkflowHttpCredentialsBackfillReport,
} from "../workflow-http-credentials-backfill.service.ts";
import { WorkflowHttpSecretsService } from "../workflow-http-secrets.service.ts";

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
  dsl: { version: "1", name: "Flow", nodes, edges: [] },
  createdAt: at,
  updatedAt: at,
});

type SecretRow = Awaited<ReturnType<SecretApi["create"]>>;

function build(options: { limit?: number; savedDuringMove?: boolean; projectIds?: string[] } = {}) {
  const secrets: Record<string, string> = {};
  const nodesOf: Record<string, unknown[]> = {
    "v-latest": [node("n1", TOKEN)],
    "v-published": [node("n1", TOKEN)],
  };
  const walked: string[] = [];
  const saved: WorkflowHttpCredentialsBackfillReport[] = [];
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
  const backfill = WorkflowHttpCredentialsBackfillService.create({
    workflows: {
      findProjectIds: async () => options.projectIds ?? ["project-1"],
      findAll: async ({ projectId }) => {
        walked.push(projectId);

        return [createApiFixture<Workflow>({ id: "wf-1" })];
      },
      findById: async () => ({
        ...createApiFixture<Workflow>({ id: "wf-1" }),
        latestVersion: versionOf("v-latest", nodesOf["v-latest"] ?? []),
        currentVersion: versionOf("v-latest", nodesOf["v-latest"] ?? []),
      }),
      findPublishedVersion: async () => versionOf("v-published", nodesOf["v-published"] ?? []),
      updateVersionDslIfUnchanged: async ({ id, dsl }) => {
        if (options.savedDuringMove) {
          nodesOf[id] = [node("n1", "{{ secrets.NEWER }}")];
          return false;
        }
        nodesOf[id] = Array.isArray(dsl.nodes) ? dsl.nodes : [];

        return true;
      },
    },
    httpSecrets: WorkflowHttpSecretsService.create(secretApi),
  });
  const run = (input: { dryRun?: boolean; afterProjectId?: string } = {}) =>
    backfill.moveLiterals({
      dryRun: input.dryRun ?? false,
      signal: new AbortController().signal,
      afterProjectId: input.afterProjectId ?? null,
      onProjectDone: (report) => {
        saved.push(report);
        return Promise.resolve();
      },
    });

  return { run, secrets, nodesOf, walked, saved };
}

describe("the workflow credential step moving inline HTTP node credentials to project secrets", () => {
  /** @scenario "Credentials typed inline before this change are moved to project secrets" */
  it("rewrites the latest and published versions with references, once however often it runs", async () => {
    const { run, secrets, nodesOf } = build();

    const first = await run();
    const second = await run();

    expect(first).toMatchObject({ moved: 2, held: 0, afterProjectId: "project-1" });
    expect(second).toMatchObject({ moved: 0, held: 0 });
    expect(Object.values(secrets)).toContain(TOKEN);
    expect(JSON.stringify(nodesOf)).not.toContain(TOKEN);
  });

  /** @scenario "Credentials typed inline before this change are moved to project secrets" */
  it("stores nothing and saves no progress on a dry run, reporting what it would move", async () => {
    const { run, secrets, nodesOf, saved } = build();

    const report = await run({ dryRun: true });

    expect(report.moved).toBe(2);
    expect(secrets).toEqual({});
    expect(saved).toEqual([]);
    expect(JSON.stringify(nodesOf)).toContain(TOKEN);
  });

  /** @scenario "A workflow credential that cannot be moved holds the workflow credential step" */
  it("leaves the node as it was and fails with progress kept before the held project", async () => {
    const { run, nodesOf, saved } = build({ limit: 0 });

    await expect(run()).rejects.toThrow(/2 workflow version\(s\) still hold HTTP credentials/);

    expect(JSON.stringify(nodesOf["v-latest"])).toContain(TOKEN);
    expect(saved.map((report) => report.afterProjectId)).toEqual([null]);
  });

  /**
   * @scenario "A workflow version saved while its credentials are being moved keeps the newer save"
   * @scenario "A version saved while the backfill runs keeps that save"
   */
  it("keeps a save made after the read and counts the version moved once a re-read is clean", async () => {
    const { run, nodesOf } = build({ savedDuringMove: true });

    const report = await run();

    expect(report).toMatchObject({ moved: 2, held: 0 });
    expect(JSON.stringify(nodesOf["v-latest"])).toContain("{{ secrets.NEWER }}");
  });

  /** @scenario "The workflow credential step resumes after the last project it finished" */
  it("starts with the project after the saved progress", async () => {
    const { run, walked } = build({ projectIds: ["project-1", "project-2"] });

    await run({ afterProjectId: "project-1" });

    expect(walked).toEqual(["project-2"]);
  });
});

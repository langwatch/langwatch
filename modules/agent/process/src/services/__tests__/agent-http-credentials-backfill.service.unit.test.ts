import type { SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryAgentRepositories } from "../../repositories/memory/memory.agent.repositories.ts";
import {
  AgentHttpCredentialsBackfillService,
  type AgentHttpCredentialsBackfillReport,
} from "../agent-http-credentials-backfill.service.ts";
import { AgentHttpSecretsService } from "../agent-http-secrets.service.ts";
import { AgentService } from "../agent.service.ts";

const TOKEN = "tok_live_old_123";

type SecretRow = Awaited<ReturnType<SecretApi["create"]>>;

const httpConfig = (token: string) => ({
  url: "https://a.example",
  method: "POST" as const,
  auth: { type: "bearer" as const, token },
});

async function build(options: { refusedProjectId?: string; savedDuringMove?: boolean } = {}) {
  const values: Record<string, Record<string, string>> = {};
  const secrets = createApiFixture<SecretApi>({
    list: async ({ projectId }) =>
      Object.keys(values[projectId] ?? {}).map((name) =>
        createApiFixture<SecretRow>({ id: name, name }),
      ),
    getValuesByName: async ({ projectId, names }) =>
      Object.fromEntries(
        Object.entries(values[projectId] ?? {}).filter(([name]) => names.includes(name)),
      ),
    create: async (input) => {
      if (input.projectId === options.refusedProjectId) throw new Error("secret limit");
      values[input.projectId] = { ...values[input.projectId], [input.name]: input.value };

      return createApiFixture<SecretRow>({ id: input.name, name: input.name });
    },
  });
  const { agents: repository } = MemoryAgentRepositories.create();
  const seed = (input: { id: string; projectId: string; token: string }) =>
    repository.create({ ...input, name: input.id, type: "http", config: httpConfig(input.token) });
  await seed({ id: "agent_a", projectId: "project_a", token: TOKEN });
  await seed({ id: "agent_b", projectId: "project_b", token: TOKEN });
  await seed({ id: "agent_ref", projectId: "project_b", token: "{{ secrets.ALREADY }}" });

  const agents = AgentService.create(repository);
  const saved: AgentHttpCredentialsBackfillReport[] = [];
  const backfill = AgentHttpCredentialsBackfillService.create({
    agents: {
      findProjectIdsWithHttpAgents: () => repository.findProjectIdsWithHttpAgents(),
      findAll: (input) => repository.findAll(input),
      getByIdIncludingArchived: (input) => repository.getByIdIncludingArchived(input),
      updateConfigIfUnchanged: async (input) => {
        if (!options.savedDuringMove) return repository.updateConfigIfUnchanged(input);
        const newer = httpConfig("{{ secrets.NEWER }}");
        await repository.update({
          id: input.id,
          projectId: input.projectId,
          type: "http",
          config: newer,
        });

        return false;
      },
    },
    httpSecrets: AgentHttpSecretsService.create({ secrets, agents }),
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
  const configOf = async (id: string, projectId: string) =>
    JSON.stringify((await agents.getById({ id, projectId })).config);

  return { run, values, saved, configOf };
}

describe("the agent credential step moving inline HTTP agent credentials to project secrets", () => {
  /** @scenario "Credentials typed into an HTTP agent before this change are moved to project secrets" */
  it("moves each literal once, however often the step runs, and leaves references alone", async () => {
    const { run, values, configOf } = await build();

    const first = await run();
    const second = await run();

    expect(first).toMatchObject({ moved: 2, held: 0, afterProjectId: "project_b" });
    expect(second).toMatchObject({ moved: 0, held: 0 });
    expect(values).toEqual({
      project_a: { HTTP_AGENT_A_AUTH_TOKEN: TOKEN },
      project_b: { HTTP_AGENT_B_AUTH_TOKEN: TOKEN },
    });
    expect(await configOf("agent_a", "project_a")).toContain(
      "{{ secrets.HTTP_AGENT_A_AUTH_TOKEN }}",
    );
    expect(await configOf("agent_a", "project_a")).not.toContain(TOKEN);
    expect(await configOf("agent_ref", "project_b")).toContain("{{ secrets.ALREADY }}");
  });

  /** @scenario "Credentials typed into an HTTP agent before this change are moved to project secrets" */
  it("stores nothing and saves no progress on a dry run, reporting what it would move", async () => {
    const { run, values, saved, configOf } = await build();

    const report = await run({ dryRun: true });

    expect(report.moved).toBe(2);
    expect(values).toEqual({});
    expect(saved).toEqual([]);
    expect(await configOf("agent_a", "project_a")).toContain(TOKEN);
  });

  /** @scenario "An agent credential that cannot be moved holds the agent credential step" */
  it("moves every other agent, then fails with progress kept before the held project", async () => {
    const { run, values, saved, configOf } = await build({ refusedProjectId: "project_a" });

    await expect(run()).rejects.toThrow(/1 HTTP agent credential\(s\) could not be stored/);

    expect(await configOf("agent_a", "project_a")).toContain(TOKEN);
    expect(values).toEqual({ project_b: { HTTP_AGENT_B_AUTH_TOKEN: TOKEN } });
    expect(saved.map((report) => report.afterProjectId)).toEqual([null, null]);
  });

  /** @scenario "An agent saved while its credential is being moved keeps the newer save" */
  it("keeps a save made after the read and counts the agent moved once a re-read is clean", async () => {
    const { run, configOf } = await build({ savedDuringMove: true });

    const report = await run();

    expect(report).toMatchObject({ moved: 2, held: 0 });
    expect(await configOf("agent_a", "project_a")).toContain("{{ secrets.NEWER }}");
    expect(await configOf("agent_a", "project_a")).not.toContain(TOKEN);
  });

  /** @scenario "The agent credential step resumes after the last project it finished" */
  it("starts with the project after the saved progress", async () => {
    const { run, values, configOf } = await build();

    await run({ afterProjectId: "project_a" });

    expect(await configOf("agent_a", "project_a")).toContain(TOKEN);
    expect(values).toEqual({ project_b: { HTTP_AGENT_B_AUTH_TOKEN: TOKEN } });
  });
});

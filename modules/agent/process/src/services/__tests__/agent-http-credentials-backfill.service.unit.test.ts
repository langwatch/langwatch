import {
  SecretLimitReachedError,
  SecretNotFoundError,
  type SecretApi,
} from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryAgentRepositories } from "../../repositories/memory/memory.agent.repositories.ts";
import {
  AgentHttpCredentialsBackfillService,
  NAMED_AGENTS_REPORTED,
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

async function build(
  options: {
    refused?: { projectId: string; error: unknown };
    savedDuringMove?: boolean;
    storedConfig?: { config: unknown };
    producedConfig?: unknown;
    stored?: Record<string, Record<string, string>>;
    extraAgentsInProjectA?: number;
  } = {},
) {
  const values: Record<string, Record<string, string>> = { ...options.stored };
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
      if (input.projectId === options.refused?.projectId) throw options.refused.error;
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
  for (let index = 0; index < (options.extraAgentsInProjectA ?? 0); index++) {
    await seed({ id: `agent_extra_${index}`, projectId: "project_a", token: TOKEN });
  }

  const agents = AgentService.create(repository);
  const realSecrets = AgentHttpSecretsService.create({ secrets, agents });
  const saved: AgentHttpCredentialsBackfillReport[] = [];
  const backfill = AgentHttpCredentialsBackfillService.create({
    agents: {
      findProjectIdsWithHttpAgents: () => repository.findProjectIdsWithHttpAgents(),
      findAll: async (input) =>
        (await repository.findAll(input)).map((agent) =>
          agent.id === "agent_a" && options.storedConfig
            ? ({ ...agent, config: options.storedConfig.config } as typeof agent)
            : agent,
        ),
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
    httpSecrets: options.producedConfig
      ? {
          forUpdate: async (input) => ({
            ...(await realSecrets.forUpdate(input)),
            config: options.producedConfig as ReturnType<typeof httpConfig>,
          }),
        }
      : realSecrets,
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
    const { run, values, saved, configOf } = await build({
      refused: { projectId: "project_a", error: new Error("connection reset") },
    });

    await expect(run()).rejects.toThrow(
      /1 HTTP agent credential\(s\) could not be stored .*agent agent_a in project project_a: Error/,
    );

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

  /** @scenario "An agent credential that can never be moved is left in place and the step completes" */
  it("completes, keeping the literal and reporting why, when the agent's project is an orphan", async () => {
    const { run, values, saved, configOf } = await build({
      refused: { projectId: "project_a", error: new SecretNotFoundError() },
    });

    const report = await run();

    expect(report).toMatchObject({
      moved: 1,
      held: 0,
      afterProjectId: "project_b",
      keptCount: 1,
      kept: [{ agentId: "agent_a", projectId: "project_a", reason: "project_not_found" }],
      failed: [],
    });
    expect(await configOf("agent_a", "project_a")).toContain(TOKEN);
    expect(values).toEqual({ project_b: { HTTP_AGENT_B_AUTH_TOKEN: TOKEN } });
    expect(saved.map((progress) => progress.afterProjectId)).toEqual(["project_a", "project_b"]);
  });

  /** @scenario "An agent credential an operator can unblock holds the step, naming the agent and why" */
  it("moves every other agent, then fails naming the agent at the secret limit", async () => {
    const { run, values, saved, configOf } = await build({
      refused: { projectId: "project_a", error: new SecretLimitReachedError() },
    });

    await expect(run()).rejects.toThrow(
      /1 HTTP agent credential\(s\) could not be stored .*agent agent_a in project project_a: secret_limit_reached/,
    );

    expect(await configOf("agent_a", "project_a")).toContain(TOKEN);
    expect(values).toEqual({ project_b: { HTTP_AGENT_B_AUTH_TOKEN: TOKEN } });
    expect(saved.at(-1)).toMatchObject({ afterProjectId: null, held: 1, keptCount: 0, kept: [] });
  });

  /** @scenario "The agent credential step's report names a bounded number of agents" */
  it("names at most 20 kept agents and counts all 25", async () => {
    const { run, saved } = await build({
      refused: { projectId: "project_a", error: new SecretNotFoundError() },
      extraAgentsInProjectA: 24,
    });

    const report = await run();

    expect(report).toMatchObject({ moved: 1, held: 0, keptCount: 25 });
    expect(report.kept).toHaveLength(NAMED_AGENTS_REPORTED);
    expect(saved.every((progress) => progress.kept.length <= NAMED_AGENTS_REPORTED)).toBe(true);
  });

  /** @scenario "The agent credential step's report names a bounded number of agents" */
  it("names at most 20 held agents and counts all 25 in the failure", async () => {
    const { run, saved } = await build({
      refused: { projectId: "project_a", error: new SecretLimitReachedError() },
      extraAgentsInProjectA: 24,
    });

    await expect(run()).rejects.toThrow(/^25 HTTP agent credential\(s\).*and 20 more/);

    expect(saved.at(-1)?.held).toBe(25);
    expect(saved.at(-1)?.failed).toHaveLength(NAMED_AGENTS_REPORTED);
  });

  /** @scenario "An agent credential that can never be moved is left in place and the step completes" */
  it("completes, keeping the literal as config_invalid, when the stored config is invalid", async () => {
    const { run, configOf } = await build({
      storedConfig: { config: { ...httpConfig(TOKEN), url: 42 } },
    });

    const report = await run();

    expect(report).toMatchObject({
      held: 0,
      kept: [{ agentId: "agent_a", projectId: "project_a", reason: "config_invalid" }],
      failed: [],
    });
    expect(await configOf("agent_a", "project_a")).toContain(TOKEN);
  });

  /** @scenario "A config the credential step produced that fails validation holds the step" */
  it("fails the step naming the agent when the config it produced is invalid", async () => {
    const { run, configOf } = await build({ producedConfig: { ...httpConfig("x"), url: 42 } });

    await expect(run()).rejects.toThrow(/agent agent_a in project project_a: ZodError/);

    expect(await configOf("agent_a", "project_a")).toContain(TOKEN);
  });

  /** @scenario "A credential already stored as a project secret is referenced, not stored again" */
  it("references a secret already holding the value instead of storing it again", async () => {
    const { run, values, configOf } = await build({
      stored: { project_a: { HTTP_AGENT_A_AUTH_TOKEN: TOKEN } },
      refused: { projectId: "project_a", error: new Error("no write expected") },
    });

    const report = await run();

    expect(report).toMatchObject({ moved: 2, held: 0, kept: [] });
    expect(values.project_a).toEqual({ HTTP_AGENT_A_AUTH_TOKEN: TOKEN });
    expect(await configOf("agent_a", "project_a")).toContain(
      "{{ secrets.HTTP_AGENT_A_AUTH_TOKEN }}",
    );
  });
});

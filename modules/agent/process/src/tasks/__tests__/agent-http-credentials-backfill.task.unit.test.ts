import type { SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryAgentRepositories } from "../../repositories/memory/memory.agent.repositories.ts";
import { AgentHttpSecretsService } from "../../services/agent-http-secrets.service.ts";
import { AgentService } from "../../services/agent.service.ts";
import { AgentHttpCredentialsBackfillTask } from "../agent-http-credentials-backfill.task.ts";

const TOKEN = "tok_live_old_123";

type SecretRow = Awaited<ReturnType<SecretApi["create"]>>;

const httpConfig = (token: string) => ({
  url: "https://a.example",
  method: "POST" as const,
  auth: { type: "bearer" as const, token },
});

async function build(options: { refusedProjectId?: string } = {}) {
  const values: Record<string, Record<string, string>> = {};
  const updates: string[] = [];
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
  const counted = {
    listProjectIdsWithHttpAgents: () => agents.listProjectIdsWithHttpAgents(),
    getAll: (input: { projectId: string }) => agents.getAll(input),
    update: (command: Parameters<AgentService["update"]>[0]) => {
      updates.push(command.id);
      return agents.update(command);
    },
  };
  const task = AgentHttpCredentialsBackfillTask.create({
    agents: counted,
    httpSecrets: AgentHttpSecretsService.create({ secrets, agents }),
  });
  const run = () => task.run({ args: [], signal: new AbortController().signal });
  const configOf = async (id: string, projectId: string) =>
    JSON.stringify((await agents.getById({ id, projectId })).config);

  return { run, values, updates, configOf };
}

describe("moving HTTP agent credentials typed inline before they became project secrets", () => {
  /** @scenario "Credentials typed into an HTTP agent before this change are moved to project secrets" */
  it("moves a literal credential once, however often the task runs", async () => {
    const { run, values, updates, configOf } = await build();

    await run();
    await run();

    expect(updates.toSorted()).toEqual(["agent_a", "agent_b"]);
    expect(values).toEqual({
      project_a: { HTTP_AGENT_A_AUTH_TOKEN: TOKEN },
      project_b: { HTTP_AGENT_B_AUTH_TOKEN: TOKEN },
    });
    expect(await configOf("agent_a", "project_a")).toContain(
      "{{ secrets.HTTP_AGENT_A_AUTH_TOKEN }}",
    );
    expect(await configOf("agent_a", "project_a")).not.toContain(TOKEN);
  });

  /** @scenario "Credentials typed into an HTTP agent before this change are moved to project secrets" */
  it("leaves an agent already holding a secret reference alone", async () => {
    const { run, updates, configOf } = await build();

    await run();

    expect(updates).not.toContain("agent_ref");
    expect(await configOf("agent_ref", "project_b")).toContain("{{ secrets.ALREADY }}");
  });

  /** @scenario "Credentials typed into an HTTP agent before this change are moved to project secrets" */
  it("keeps walking when one agent's credential cannot be stored", async () => {
    const { run, values, configOf } = await build({ refusedProjectId: "project_a" });

    await run();

    expect(await configOf("agent_a", "project_a")).toContain(TOKEN);
    expect(values).toEqual({ project_b: { HTTP_AGENT_B_AUTH_TOKEN: TOKEN } });
  });
});

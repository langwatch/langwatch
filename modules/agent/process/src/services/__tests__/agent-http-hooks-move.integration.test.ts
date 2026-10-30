/**
 * The save the HTTP agent form sends when the hooks URL moves to another origin: a read keeps
 * `{{ secrets.NAME }}` references, so the form sends them back (agent-http-editor-drawer test).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { AgentStoredCredentialsDestinationError } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";

import { createAgentAppFixture, secretStoreFixture } from "../../app/__tests__/agent.fixture.ts";
import { agentWithoutSecrets } from "../../rules/agent-secrets.rules.ts";

const agent = (config: Record<string, unknown>) => ({
  id: "agent_1",
  projectId: "project_1",
  name: "Support bot",
  type: "http" as const,
  config: {
    url: "https://support.example/chat",
    method: "POST" as const,
    hooks: { setup: true, teardown: true },
    ...config,
  },
});

async function savedWithHooks() {
  const { secrets } = secretStoreFixture();
  const { app } = createAgentAppFixture({ secrets });
  await app.create(
    agent({
      auth: { type: "bearer", token: "tok_live_support" },
      hooksUrl: "https://support.example/hooks",
      hooksSigningSecret: "whsec_test_fixture_secret",
    }),
  );
  const read = agentWithoutSecrets(await app.getById({ id: "agent_1", projectId: "project_1" }));
  return { app, read };
}

describe("a save from the form that moves the hooks URL to another origin", () => {
  /** @scenario "A new hooks URL on another origin is refused when the form sends the stored references back" */
  it("is refused when it sends the stored references back", async () => {
    const { app, read } = await savedWithHooks();

    const save = app.update(agent({ ...read.config, hooksUrl: "https://other.example.net/hooks" }));

    await expect(save).rejects.toBeInstanceOf(AgentStoredCredentialsDestinationError);
  });

  /** @scenario "A hooks URL on another origin is allowed when every credential is typed again" */
  it("is allowed once the token is typed again and the secret rotated", async () => {
    const { app, read } = await savedWithHooks();

    const saved = await app.update(
      agent({
        ...read.config,
        hooksUrl: "https://other.example.net/hooks",
        auth: { type: "bearer", token: "tok_live_other" },
        hooksSigningSecret: "whsec_test_rotated_secret",
      }),
    );

    expect(saved.config).toMatchObject({ hooksUrl: "https://other.example.net/hooks" });
  });
});

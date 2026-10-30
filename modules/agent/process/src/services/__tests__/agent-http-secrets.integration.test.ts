import { describe, expect, it } from "vitest";

import { createAgentAppFixture, secretStoreFixture } from "../../app/__tests__/agent.fixture.ts";
import { agentWithoutSecrets } from "../../rules/agent-secrets.rules.ts";

const TOKEN = "tok_live_support_123";

const httpAgent = (token: string) => ({
  id: "agent_http",
  projectId: "project_1",
  name: "Support bot",
  type: "http" as const,
  config: {
    url: "https://support.example/chat",
    method: "POST" as const,
    auth: { type: "bearer" as const, token },
  },
});

describe("a token typed into an HTTP agent", () => {
  /** @scenario A token typed into an HTTP agent is stored as a project secret and never read back */
  it("is stored as a project secret, and the agent keeps only the reference", async () => {
    const { secrets, values } = secretStoreFixture();
    const { app } = createAgentAppFixture({ secrets });

    const created = await app.create(httpAgent(TOKEN));
    const read = agentWithoutSecrets(
      await app.getById({ id: "agent_http", projectId: "project_1" }),
    );

    expect(values).toEqual({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });
    expect(JSON.stringify(created)).not.toContain(TOKEN);
    expect(JSON.stringify(read)).not.toContain(TOKEN);
    expect(JSON.stringify(read)).toContain("{{ secrets.HTTP_AGENT_HTTP_AUTH_TOKEN }}");
  });

  /** @scenario A blank token on a saved HTTP agent keeps its reference */
  it("keeps its stored reference when it is saved again with the token left blank", async () => {
    const { secrets, values } = secretStoreFixture();
    const { app } = createAgentAppFixture({ secrets });
    await app.create(httpAgent(TOKEN));

    const updated = await app.update({ ...httpAgent(""), name: "Support bot v2" });

    expect(JSON.stringify(updated)).toContain("{{ secrets.HTTP_AGENT_HTTP_AUTH_TOKEN }}");
    expect(Object.keys(values)).toEqual(["HTTP_AGENT_HTTP_AUTH_TOKEN"]);
  });

  it("stores a new token typed into a saved agent as a secret of its own", async () => {
    const { secrets, values } = secretStoreFixture();
    const { app } = createAgentAppFixture({ secrets });
    await app.create(httpAgent(TOKEN));

    await app.update(httpAgent("tok_live_rotated_456"));

    expect(values).toEqual({
      HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN,
      HTTP_AGENT_HTTP_AUTH_TOKEN_2: "tok_live_rotated_456",
    });
  });
});

describe("a hooks signing secret typed into an HTTP agent", () => {
  const SIGNING_SECRET = "whsec_0123456789abcdef0123456789abcdef";
  const withHooks = (hooksSigningSecret: string) => {
    const agent = httpAgent("{{ secrets.HTTP_AGENT_HTTP_AUTH_TOKEN }}");
    return {
      ...agent,
      config: {
        ...agent.config,
        hooksUrl: "https://support.example/hooks",
        hooks: { setup: true, teardown: true },
        hooksSigningSecret,
      },
    };
  };

  /**
   * @scenario "The hooks signing secret is saved as a project secret and never read back"
   */
  it("is stored as a project secret, and a read shows only the reference", async () => {
    const { secrets, values } = secretStoreFixture();
    const { app } = createAgentAppFixture({ secrets });

    const created = await app.create(withHooks(SIGNING_SECRET));
    const read = agentWithoutSecrets(
      await app.getById({ id: "agent_http", projectId: "project_1" }),
    );

    expect(values).toEqual({ HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET: SIGNING_SECRET });
    expect(JSON.stringify(created)).not.toContain(SIGNING_SECRET);
    expect(JSON.stringify(read)).not.toContain(SIGNING_SECRET);
    expect(read.config).toMatchObject({
      hooksSigningSecret: "{{ secrets.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET }}",
    });
  });

  it("keeps its reference on a save with the secret left blank, and rotates to a new one", async () => {
    const { secrets, values } = secretStoreFixture();
    const { app } = createAgentAppFixture({ secrets });
    await app.create(withHooks(SIGNING_SECRET));

    const kept = await app.update(withHooks(""));
    expect(kept.config).toMatchObject({
      hooksSigningSecret: "{{ secrets.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET }}",
    });

    const rotated = await app.update(withHooks("whsec_rotated"));
    expect(rotated.config).toMatchObject({
      hooksSigningSecret: "{{ secrets.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET_2 }}",
    });
    expect(values.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET_2).toBe("whsec_rotated");
  });
});

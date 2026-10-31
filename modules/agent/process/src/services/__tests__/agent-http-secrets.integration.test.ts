import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

    const rotated = await app.update(withHooks("whsec_rotated_0123456789"));
    expect(rotated.config).toMatchObject({
      hooksSigningSecret: "{{ secrets.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET_2 }}",
    });
    expect(values.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET_2).toBe("whsec_rotated_0123456789");
  });

  describe("when the signing secret is rotated", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** @scenario "Rotating the hooks signing secret keeps the old one valid for 24 hours" */
    it("keeps the replaced secret for 24 hours as the previous one", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
      const { secrets, values } = secretStoreFixture({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });
      const { app } = createAgentAppFixture({ secrets });
      await app.create(withHooks(SIGNING_SECRET));

      const rotated = await app.update(withHooks("whsec_rotated_once"));

      expect(rotated.config).toMatchObject({
        hooksSigningSecret: "{{ secrets.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET_2 }}",
        hooksPreviousSigningSecret: {
          secret: "{{ secrets.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET }}",
          expiresAt: "2026-10-31T12:00:00Z",
        },
      });
      expect(values).toEqual({
        HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN,
        HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET: SIGNING_SECRET,
        HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET_2: "whsec_rotated_once",
      });
    });

    /** @scenario "A second rotation inside the window drops the oldest secret at once" */
    it("deletes the oldest secret at once on a second rotation inside the window", async () => {
      const { secrets, values } = secretStoreFixture({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });
      const { app } = createAgentAppFixture({ secrets });
      await app.create(withHooks(SIGNING_SECRET));

      await app.update(withHooks("whsec_rotated_once"));
      const twice = await app.update(withHooks("whsec_rotated_twice"));

      expect(twice.config).toMatchObject({
        hooksSigningSecret: "{{ secrets.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET_3 }}",
        hooksPreviousSigningSecret: {
          secret: "{{ secrets.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET_2 }}",
        },
      });
      expect(values).toEqual({
        HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN,
        HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET_2: "whsec_rotated_once",
        HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET_3: "whsec_rotated_twice",
      });
    });

    /** @scenario "The replaced hooks signing secret stops signing and is deleted once it expires" */
    it("deletes the replaced secret at the first save after its window closed", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
      const { secrets, values } = secretStoreFixture({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });
      const { app } = createAgentAppFixture({ secrets });
      await app.create(withHooks(SIGNING_SECRET));
      await app.update(withHooks("whsec_rotated_once"));

      vi.setSystemTime(new Date("2026-10-31T11:59:59Z"));
      await app.update({ ...withHooks(""), name: "Still open" });
      expect(values).toHaveProperty("HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET");

      vi.setSystemTime(new Date("2026-10-31T12:00:01Z"));
      const saved = await app.update({ ...withHooks(""), name: "Closed" });

      expect(saved.config).not.toHaveProperty("hooksPreviousSigningSecret");
      expect(values).toEqual({
        HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN,
        HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET_2: "whsec_rotated_once",
      });
    });

    it("deletes the current and the previous secret when the hooks URL is cleared inside the window", async () => {
      const { secrets, values } = secretStoreFixture({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });
      const { app } = createAgentAppFixture({ secrets });
      await app.create(withHooks(SIGNING_SECRET));
      await app.update(withHooks("whsec_rotated_once"));
      const { hooksUrl: _cleared, hooks: _hooks, ...config } = withHooks("").config;

      const updated = await app.update({ ...withHooks(""), config });

      expect(updated.config).not.toHaveProperty("hooksSigningSecret");
      expect(updated.config).not.toHaveProperty("hooksPreviousSigningSecret");
      expect(values).toEqual({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });
    });

    it("ignores a previous signing secret the write sends itself", async () => {
      const { secrets } = secretStoreFixture({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });
      const { app } = createAgentAppFixture({ secrets });
      const forged = {
        secret: "{{ secrets.HTTP_AGENT_HTTP_AUTH_TOKEN }}",
        expiresAt: "2999-01-01T00:00:00Z",
      };
      const sent = (signingSecret: string) => {
        const agent = withHooks(signingSecret);
        return { ...agent, config: { ...agent.config, hooksPreviousSigningSecret: forged } };
      };

      const created = await app.create(sent(SIGNING_SECRET));
      const updated = await app.update(sent(""));

      expect(created.config).not.toHaveProperty("hooksPreviousSigningSecret");
      expect(updated.config).not.toHaveProperty("hooksPreviousSigningSecret");
    });
  });

  describe("when the hooks URL moves to another origin", () => {
    const moved = (token: string, hooksSigningSecret: string) => {
      const agent = withHooks(hooksSigningSecret);
      return {
        ...agent,
        config: {
          ...agent.config,
          auth: { type: "bearer" as const, token },
          hooksUrl: "https://receiver.example.org/hooks",
        },
      };
    };

    let app: ReturnType<typeof createAgentAppFixture>["app"];
    let values: Record<string, string>;
    let before: Record<string, string>;

    beforeEach(async () => {
      const store = secretStoreFixture();
      ({ app } = createAgentAppFixture({ secrets: store.secrets }));
      values = store.values;
      await app.create(moved(TOKEN, SIGNING_SECRET));
      before = { ...values };
    });

    /** @scenario A hooks URL on another origin is allowed when every credential is typed again */
    it("allows every credential typed again with its stored value, and makes no new secret", async () => {
      const updated = await app.update({
        ...moved(TOKEN, SIGNING_SECRET),
        config: { ...moved(TOKEN, SIGNING_SECRET).config, hooksUrl: "https://new.example.net/h" },
      });

      expect(updated.config).toMatchObject({
        hooksUrl: "https://new.example.net/h",
        hooksSigningSecret: "{{ secrets.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET }}",
      });
      expect(values).toEqual(before);
    });

    /** @scenario A new hooks URL on another origin is refused when the form sends the stored references back */
    it("refuses a stored reference sent back, before any new secret is made", async () => {
      const sentBack = moved(
        "{{ secrets.HTTP_AGENT_HTTP_AUTH_TOKEN }}",
        "whsec_typed_for_the_new_host",
      );

      await expect(
        app.update({
          ...sentBack,
          config: { ...sentBack.config, hooksUrl: "https://new.example.net/h" },
        }),
      ).rejects.toMatchObject({ code: "agent_stored_credentials_destination_mismatch" });
      expect(values).toEqual(before);
    });

    /** @scenario A new hooks URL on another origin is refused when the form sends the stored references back */
    it.each([
      ["with no spaces", "{{secrets.HTTP_AGENT_HTTP_AUTH_TOKEN}}"],
      ["padded", "  {{  secrets.HTTP_AGENT_HTTP_AUTH_TOKEN }} "],
      ["behind a scheme in another case", "BEARER {{ secrets.HTTP_AGENT_HTTP_AUTH_TOKEN }}"],
    ])("refuses a stored reference sent back %s", async (_spelling, token) => {
      const sentBack = moved(token, "whsec_typed_for_the_new_host");

      await expect(
        app.update({
          ...sentBack,
          config: { ...sentBack.config, hooksUrl: "https://new.example.net/h" },
        }),
      ).rejects.toMatchObject({ code: "agent_stored_credentials_destination_mismatch" });
      expect(values).toEqual(before);
    });
  });

  describe("when the hooks URL has a template in its scheme or host", () => {
    /** @scenario A hooks URL with a template in its scheme or host is refused on save */
    it.each([
      "https://{{ params.host }}/hooks",
      "https://hooks.{{ params.domain }}/hooks",
      "{{ params.scheme }}://support.example/hooks",
      "{{ params.base }}/hooks",
      "https://user:{{ params.password }}@support.example/hooks",
      "https:///{{ params.host }}/hooks",
      "https:/{{ params.host }}/hooks",
      "https:/\\{{ params.host }}/hooks",
      "HTTPS:\\/{{ params.host }}/hooks",
      " https:////{{ params.host }}",
    ])("refuses %j, on create and on update, before any secret is made", async (hooksUrl) => {
      const { secrets, values } = secretStoreFixture({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });
      const { app } = createAgentAppFixture({ secrets });
      const templated = { ...withHooks(SIGNING_SECRET).config, hooksUrl };

      await expect(
        app.create({ ...withHooks(SIGNING_SECRET), config: templated }),
      ).rejects.toMatchObject({ code: "agent_hooks_url_templated_origin" });
      expect(values).toEqual({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });

      await app.create(withHooks(SIGNING_SECRET));
      const saved = { ...values };
      await expect(
        app.update({
          ...withHooks(""),
          config: { ...templated, hooksSigningSecret: "whsec_rotated_0123456789" },
        }),
      ).rejects.toMatchObject({ code: "agent_hooks_url_templated_origin" });
      expect(values).toEqual(saved);
    });

    it("accepts a template in the path or the query", async () => {
      const { secrets } = secretStoreFixture({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });
      const { app } = createAgentAppFixture({ secrets });
      const hooksUrl = "https://support.example/{{ params.tenant }}/hooks?run={{ params.run }}";

      const created = await app.create({
        ...withHooks(SIGNING_SECRET),
        config: { ...withHooks(SIGNING_SECRET).config, hooksUrl },
      });

      expect(created.config).toMatchObject({ hooksUrl });
    });
  });

  /** @scenario Removing the hooks URL deletes the hooks signing secret */
  it("deletes the stored secret when the hooks URL is cleared, even if its reference is sent back", async () => {
    const { secrets, values } = secretStoreFixture({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });
    const { app } = createAgentAppFixture({ secrets });
    await app.create(withHooks(SIGNING_SECRET));
    const {
      hooksUrl: _cleared,
      hooks: _hooks,
      ...config
    } = withHooks("{{ secrets.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET }}").config;

    const updated = await app.update({ ...withHooks(""), config });

    expect(updated.config).not.toHaveProperty("hooksSigningSecret");
    expect(values).toEqual({ HTTP_AGENT_HTTP_AUTH_TOKEN: TOKEN });
  });

  it("makes no project secret for a signing secret saved with no hooks URL", async () => {
    const { secrets, values } = secretStoreFixture();
    const { app } = createAgentAppFixture({ secrets });
    const { hooksUrl: _none, ...config } = withHooks(SIGNING_SECRET).config;

    const created = await app.create({ ...withHooks(SIGNING_SECRET), config });

    expect(created.config).not.toHaveProperty("hooksSigningSecret");
    expect(values).toEqual({});
  });

  /** @scenario An update that omits the hooks signing secret keeps the stored reference */
  it("keeps its reference when an update omits the secret altogether", async () => {
    const { secrets, values } = secretStoreFixture();
    const { app } = createAgentAppFixture({ secrets });
    await app.create(withHooks(SIGNING_SECRET));
    const { hooksSigningSecret: _omitted, ...config } = withHooks(SIGNING_SECRET).config;

    const updated = await app.update({ ...withHooks(SIGNING_SECRET), name: "Renamed", config });

    expect(updated.config).toMatchObject({
      hooksSigningSecret: "{{ secrets.HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET }}",
    });
    expect(Object.keys(values)).toEqual(["HTTP_AGENT_HTTP_HOOKS_SIGNING_SECRET"]);
  });
});

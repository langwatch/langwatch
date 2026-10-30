import type { Agent, HttpAgentConfig } from "@langwatch/agent-contract";
import { Temporal } from "@langwatch/time";
import { WEBHOOK_PREVIOUS_SECRET_TTL_MS } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import {
  configForCopy,
  movesStoredSecrets,
  replacedSigningSecretNames,
  withoutHooklessSigningSecret,
  withPreviousSigningSecret,
} from "../agent-secrets.rules.ts";

const stored: HttpAgentConfig = {
  url: "https://agent.example.com/chat",
  method: "POST",
  auth: { type: "bearer", token: "{{ secrets.TOKEN }}" },
  hooksSigningSecret: "{{ secrets.SIGNING }}",
} as HttpAgentConfig;

const moves = (incoming: Partial<HttpAgentConfig>, from: HttpAgentConfig = stored) =>
  movesStoredSecrets({ stored: from, incoming: { ...from, ...incoming } });

describe("movesStoredSecrets for a hooks URL", () => {
  /** @scenario A new hooks URL on another origin is refused when it would take a stored credential */
  it("refuses another origin when the authentication is left blank", () => {
    const incoming = {
      hooksUrl: "https://evil.example.net/hooks",
      auth: { type: "bearer", token: "" },
      hooksSigningSecret: "whsec_new",
    } as Partial<HttpAgentConfig>;

    expect(moves(incoming)).toBe(true);
  });

  /** @scenario A new hooks URL on another origin is refused when it would take the stored signing secret */
  it("refuses another origin when the signing secret is left blank or omitted", () => {
    const base = {
      hooksUrl: "https://evil.example.net/hooks",
      auth: { type: "bearer", token: "tok_new" },
    } as Partial<HttpAgentConfig>;

    expect(moves({ ...base, hooksSigningSecret: "" })).toBe(true);
    expect(moves({ ...base, hooksSigningSecret: undefined })).toBe(true);
  });

  /** @scenario A first hooks URL on the turn URL's origin keeps the stored credentials */
  it("allows a first hooks URL on the origin of the turn URL", () => {
    expect(
      moves({
        hooksUrl: "https://agent.example.com/hooks",
        auth: { type: "bearer", token: "" },
        hooksSigningSecret: "",
      }),
    ).toBe(false);
  });

  it("allows a change within the stored hooks URL's origin, and removing the hooks URL", () => {
    const withHooks = { ...stored, hooksUrl: "https://hooks.example.com/a" };

    expect(
      moves({ hooksUrl: "https://hooks.example.com/b", hooksSigningSecret: "" }, withHooks),
    ).toBe(false);
    expect(moves({ hooksUrl: undefined, hooksSigningSecret: "" }, withHooks)).toBe(false);
  });

  /** @scenario A hooks URL on another origin is allowed when every credential is typed again */
  it("allows another origin when every credential is supplied again", () => {
    expect(
      moves({
        hooksUrl: "https://other.example.org/hooks",
        auth: { type: "bearer", token: "tok_new" },
        hooksSigningSecret: "whsec_new",
      }),
    ).toBe(false);
  });

  /**
   * @scenario A new hooks URL on another origin is refused when the form sends the stored references back
   * A read keeps `{{ secrets.NAME }}` references, so the form saves them back unchanged.
   */
  it("refuses another origin when the form sends the stored references back", () => {
    expect(
      moves({
        hooksUrl: "https://evil.example.net/hooks",
        auth: { type: "bearer", token: "{{ secrets.TOKEN }}" },
        hooksSigningSecret: "whsec_new",
      }),
    ).toBe(true);
    expect(
      moves({
        hooksUrl: "https://evil.example.net/hooks",
        auth: { type: "bearer", token: "tok_new" },
        hooksSigningSecret: "{{ secrets.SIGNING }}",
      }),
    ).toBe(true);
  });

  it("allows the stored references back on the stored hooks URL's origin", () => {
    const withHooks = { ...stored, hooksUrl: "https://hooks.example.com/a" };

    expect(moves({ hooksUrl: "https://hooks.example.com/b" }, withHooks)).toBe(false);
  });
});

const httpAgent = (id: string, config: Partial<HttpAgentConfig>): Agent =>
  ({
    id,
    projectId: "project_1",
    type: "http",
    config: { url: "https://agent.example.com/chat", method: "POST", ...config },
  }) as Agent;

describe("replacedSigningSecretNames", () => {
  const before = httpAgent("agent_1", {
    hooksSigningSecret: "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET }}",
  });

  it("names the old secret after a rotation that keeps no previous one, as a host move", () => {
    const after = httpAgent("agent_1", {
      hooksSigningSecret: "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET_2 }}",
    });

    expect(
      replacedSigningSecretNames({ agentId: "agent_1", before, after, projectAgents: [after] }),
    ).toEqual(["HTTP_AGENT_1_HOOKS_SIGNING_SECRET"]);
  });

  it("names a numbered old secret too, and the old one when hooks are removed", () => {
    const numbered = httpAgent("agent_1", {
      hooksSigningSecret: "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET_3 }}",
    });
    const removed = httpAgent("agent_1", {});

    expect(
      replacedSigningSecretNames({
        agentId: "agent_1",
        before: numbered,
        after: removed,
        projectAgents: [],
      }),
    ).toEqual(["HTTP_AGENT_1_HOOKS_SIGNING_SECRET_3"]);
  });

  it("names nothing when the save keeps the same secret", () => {
    expect(
      replacedSigningSecretNames({
        agentId: "agent_1",
        before,
        after: before,
        projectAgents: [before],
      }),
    ).toEqual([]);
  });

  it("names nothing for a secret the person picked", () => {
    const picked = httpAgent("agent_1", { hooksSigningSecret: "{{ secrets.MY_SIGNING }}" });
    const after = httpAgent("agent_1", { hooksSigningSecret: "whsec_new" });

    expect(
      replacedSigningSecretNames({ agentId: "agent_1", before: picked, after, projectAgents: [] }),
    ).toEqual([]);
  });

  it("names nothing while another agent of the project still names it, as a copy does", () => {
    const after = httpAgent("agent_1", {
      hooksSigningSecret: "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET_2 }}",
    });
    const copy = httpAgent("agent_copy", {
      hooksSigningSecret: "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET }}",
    });

    expect(
      replacedSigningSecretNames({
        agentId: "agent_1",
        before,
        after,
        projectAgents: [after, copy],
      }),
    ).toEqual([]);
  });
});

describe("replacedSigningSecretNames inside a rotation window", () => {
  const S0 = "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET }}";
  const S1 = "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET_2 }}";
  const S2 = "{{ secrets.HTTP_AGENT_1_HOOKS_SIGNING_SECRET_3 }}";
  const expiresAt = "2026-10-31T12:00:00.000Z";

  /** @scenario "Rotating the hooks signing secret keeps the old one valid for 24 hours" */
  it("names nothing for the secret a rotation keeps as the previous one", () => {
    const before = httpAgent("agent_1", { hooksSigningSecret: S0 });
    const after = httpAgent("agent_1", {
      hooksSigningSecret: S1,
      hooksPreviousSigningSecret: { secret: S0, expiresAt },
    });

    expect(
      replacedSigningSecretNames({ agentId: "agent_1", before, after, projectAgents: [after] }),
    ).toEqual([]);
  });

  /** @scenario "A second rotation inside the window drops the oldest secret at once" */
  it("names the previous secret a second rotation drops", () => {
    const before = httpAgent("agent_1", {
      hooksSigningSecret: S1,
      hooksPreviousSigningSecret: { secret: S0, expiresAt },
    });
    const after = httpAgent("agent_1", {
      hooksSigningSecret: S2,
      hooksPreviousSigningSecret: { secret: S1, expiresAt },
    });

    expect(
      replacedSigningSecretNames({ agentId: "agent_1", before, after, projectAgents: [after] }),
    ).toEqual(["HTTP_AGENT_1_HOOKS_SIGNING_SECRET"]);
  });

  /** @scenario "Removing the hooks URL deletes the hooks signing secret" */
  it("names the current and the previous secret when hooks are removed inside the window", () => {
    const before = httpAgent("agent_1", {
      hooksSigningSecret: S1,
      hooksPreviousSigningSecret: { secret: S0, expiresAt },
    });

    expect(
      replacedSigningSecretNames({
        agentId: "agent_1",
        before,
        after: httpAgent("agent_1", {}),
        projectAgents: [],
      }),
    ).toEqual(["HTTP_AGENT_1_HOOKS_SIGNING_SECRET_2", "HTTP_AGENT_1_HOOKS_SIGNING_SECRET"]);
  });
});

describe("withPreviousSigningSecret", () => {
  const NOW = Temporal.Instant.from("2026-10-30T12:00:00Z");
  const IN_24_HOURS = NOW.add({ milliseconds: WEBHOOK_PREVIOUS_SECRET_TTL_MS }).toString();
  const hooks = (config: Partial<HttpAgentConfig>): HttpAgentConfig =>
    ({
      url: "https://agent.example.com/chat",
      method: "POST",
      hooksUrl: "https://hooks.example.com/a",
      hooks: { setup: true, teardown: true },
      ...config,
    }) as HttpAgentConfig;
  const after = (stored: HttpAgentConfig, saved: HttpAgentConfig) =>
    withPreviousSigningSecret({ stored, saved, now: NOW }).hooksPreviousSigningSecret;

  /** @scenario "Rotating the hooks signing secret keeps the old one valid for 24 hours" */
  it("keeps the replaced secret as the previous one for 24 hours", () => {
    expect(
      after(
        hooks({ hooksSigningSecret: "{{ secrets.S0 }}" }),
        hooks({ hooksSigningSecret: "{{ secrets.S1 }}", hooksUrl: "https://hooks.example.com/b" }),
      ),
    ).toEqual({ secret: "{{ secrets.S0 }}", expiresAt: IN_24_HOURS });
  });

  /** @scenario "A second rotation inside the window drops the oldest secret at once" */
  it("keeps only the secret the second rotation replaced, never a third", () => {
    expect(
      after(
        hooks({
          hooksSigningSecret: "{{ secrets.S1 }}",
          hooksPreviousSigningSecret: { secret: "{{ secrets.S0 }}", expiresAt: IN_24_HOURS },
        }),
        hooks({ hooksSigningSecret: "{{ secrets.S2 }}" }),
      ),
    ).toEqual({ secret: "{{ secrets.S1 }}", expiresAt: IN_24_HOURS });
  });

  it("carries an open window through a save that does not rotate, whatever the write sends", () => {
    const window = { secret: "{{ secrets.S0 }}", expiresAt: "2026-10-31T00:00:00Z" };

    expect(
      after(
        hooks({ hooksSigningSecret: "{{ secrets.S1 }}", hooksPreviousSigningSecret: window }),
        hooks({
          hooksSigningSecret: "{{ secrets.S1 }}",
          hooksPreviousSigningSecret: { secret: "{{ secrets.OTHER }}", expiresAt: "2999-01-01" },
        }),
      ),
    ).toEqual(window);
  });

  /** @scenario "The replaced hooks signing secret stops signing and is deleted once it expires" */
  it("drops the previous secret once its window has closed", () => {
    expect(
      after(
        hooks({
          hooksSigningSecret: "{{ secrets.S1 }}",
          hooksPreviousSigningSecret: {
            secret: "{{ secrets.S0 }}",
            expiresAt: "2026-10-30T12:00:00Z",
          },
        }),
        hooks({ hooksSigningSecret: "{{ secrets.S1 }}" }),
      ),
    ).toBeUndefined();
  });

  it("keeps no previous secret when the hooks URL moves to another origin", () => {
    expect(
      after(
        hooks({ hooksSigningSecret: "{{ secrets.S0 }}" }),
        hooks({ hooksSigningSecret: "whsec_new", hooksUrl: "https://other.example.org/hooks" }),
      ),
    ).toBeUndefined();
  });

  /** @scenario "Removing the hooks URL deletes the hooks signing secret" */
  it("keeps no previous secret when the hooks URL is removed", () => {
    const { hooksUrl: _removed, ...withoutHooks } = hooks({});

    expect(
      after(
        hooks({
          hooksSigningSecret: "{{ secrets.S1 }}",
          hooksPreviousSigningSecret: { secret: "{{ secrets.S0 }}", expiresAt: IN_24_HOURS },
        }),
        withoutHooks as HttpAgentConfig,
      ),
    ).toBeUndefined();
  });

  it("keeps no previous secret for a first signing secret", () => {
    expect(
      after(
        hooks({ hooksUrl: undefined }),
        hooks({
          hooksSigningSecret: "{{ secrets.S0 }}",
          hooksPreviousSigningSecret: { secret: "{{ secrets.OTHER }}", expiresAt: IN_24_HOURS },
        }),
      ),
    ).toBeUndefined();
  });
});

describe("withoutHooklessSigningSecret", () => {
  /** @scenario Removing the hooks URL deletes the hooks signing secret */
  it("drops the signing secret from a config with no hooks URL", () => {
    const config = { ...stored, hooksUrl: "  " };

    expect(withoutHooklessSigningSecret(config)).not.toHaveProperty("hooksSigningSecret");
    expect(withoutHooklessSigningSecret(config)).toMatchObject({ auth: stored.auth });
  });

  it("keeps the signing secret while a hooks URL is set", () => {
    const config = { ...stored, hooksUrl: "https://agent.example.com/hooks" };

    expect(withoutHooklessSigningSecret(config)).toBe(config);
  });
});

describe("configForCopy with a rotation window", () => {
  const window = { secret: "{{ secrets.S0 }}", expiresAt: "2026-10-31T12:00:00Z" };
  const source = {
    ...httpAgent("agent_1", {
      hooksUrl: "https://hooks.example.com/a",
      hooksSigningSecret: "{{ secrets.S1 }}",
      hooksPreviousSigningSecret: window,
    }),
  } as Agent;

  it("never carries the source's window into another project", () => {
    expect(configForCopy({ source, targetProjectId: "project_2" })).not.toHaveProperty(
      "hooksPreviousSigningSecret",
    );
  });

  it("keeps the copy's own window when the copy is updated from its source", () => {
    const ownWindow = { secret: "{{ secrets.COPY_S0 }}", expiresAt: "2026-10-31T13:00:00Z" };
    const current = {
      ...httpAgent("agent_copy", {
        hooksSigningSecret: "{{ secrets.COPY_S1 }}",
        hooksPreviousSigningSecret: ownWindow,
      }),
      projectId: "project_2",
    } as Agent;

    expect(configForCopy({ source, targetProjectId: "project_2", current })).toMatchObject({
      hooksSigningSecret: "{{ secrets.COPY_S1 }}",
      hooksPreviousSigningSecret: ownWindow,
    });
  });
});

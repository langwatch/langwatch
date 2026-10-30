import type { Agent, HttpAgentConfig } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";

import {
  movesStoredSecrets,
  replacedSigningSecretNames,
  withoutHooklessSigningSecret,
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

  /** @scenario Rotating the hooks signing secret deletes the old one */
  it("names the old secret after a rotation", () => {
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

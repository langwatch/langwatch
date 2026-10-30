import type { HttpAgentConfig } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";

import { movesStoredSecrets } from "../agent-secrets.rules.ts";

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
});

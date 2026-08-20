import { describe, expect, it, vi } from "vitest";

import { GovernanceCliError } from "../cli-api";
import type { GovernanceConfig } from "../config";
import {
  classifyIngestionSetupError,
  expiredSessionHelp,
  recoverExpiredSession,
} from "../wrapper-session-recovery";

const cfg: GovernanceConfig = {
  gateway_url: "http://gw.example.com",
  control_plane_url: "http://app.example.com",
  access_token: "lw_at_stale",
};

describe("classifyIngestionSetupError", () => {
  /** @scenario "The mint 401 is recognised as an expired session" */
  it("maps the 401 the mint route returns on an expired device session", () => {
    const err = new GovernanceCliError(
      401,
      "unauthorized",
      "Session expired, run `langwatch login --device` again",
    );
    expect(classifyIngestionSetupError(err)).toBe("expired_session");
  });

  it("maps a config with no access token at all", () => {
    const err = new GovernanceCliError(
      401,
      "not_logged_in",
      "Not logged in. Run `langwatch login --device` first.",
    );
    expect(classifyIngestionSetupError(err)).toBe("expired_session");
  });

  it("keeps the both-paths-off policy error separate from an expiry", () => {
    const err = new GovernanceCliError(403, "tool_disabled", "disabled");
    expect(classifyIngestionSetupError(err)).toBe("tool_disabled");
  });

  it("treats a plain network failure as neither", () => {
    expect(classifyIngestionSetupError(new Error("ECONNREFUSED"))).toBe(
      "other",
    );
  });
});

describe("recoverExpiredSession", () => {
  /** @scenario "Without a TTY the wrapper exits and names the login command" */
  it("without a TTY, stops and names the login command", async () => {
    const result = await recoverExpiredSession({
      cfg,
      tool: "codex",
      isTTY: false,
      promptImpl: vi.fn() as never,
      loginImpl: vi.fn() as never,
    });

    expect(result.status).toBe("abort");
    if (result.status !== "abort") throw new Error("unreachable");
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("langwatch login --device");
    expect(result.message).toContain("expired");
  });

  it("without a TTY, never prompts and never logs in", async () => {
    const promptImpl = vi.fn();
    const loginImpl = vi.fn();
    await recoverExpiredSession({
      cfg,
      tool: "claude",
      isTTY: false,
      promptImpl: promptImpl as never,
      loginImpl: loginImpl as never,
    });

    expect(promptImpl).not.toHaveBeenCalled();
    expect(loginImpl).not.toHaveBeenCalled();
  });

  /** @scenario "On a TTY the wrapper offers the login and stays on direct OTLP" */
  it("on a TTY, offers the login and returns the refreshed config", async () => {
    const fresh: GovernanceConfig = { ...cfg, access_token: "lw_at_fresh" };
    const writes: string[] = [];
    const result = await recoverExpiredSession({
      cfg,
      tool: "codex",
      isTTY: true,
      promptImpl: (async () => ({ confirmed: true })) as never,
      loginImpl: (async () => fresh) as never,
      writeImpl: (s) => writes.push(s),
    });

    expect(result.status).toBe("recovered");
    if (result.status !== "recovered") throw new Error("unreachable");
    expect(result.cfg.access_token).toBe("lw_at_fresh");
    // The user is told what happened before being asked anything.
    expect(writes.join("")).toContain("expired");
    expect(writes.join("")).toContain("your own");
  });

  /** @scenario "Declining the login stops the run instead of starting the tool" */
  it("on a TTY, a declined login stops the run instead of starting the tool", async () => {
    const loginImpl = vi.fn();
    const result = await recoverExpiredSession({
      cfg,
      tool: "codex",
      isTTY: true,
      promptImpl: (async () => ({ confirmed: false })) as never,
      loginImpl: loginImpl as never,
      writeImpl: () => undefined,
    });

    expect(loginImpl).not.toHaveBeenCalled();
    expect(result.status).toBe("abort");
    if (result.status !== "abort") throw new Error("unreachable");
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("was not started");
  });

  it("on a TTY, a cancelled prompt stops the run", async () => {
    const result = await recoverExpiredSession({
      cfg,
      tool: "codex",
      isTTY: true,
      // prompts resolves to {} when the user hits Ctrl-C.
      promptImpl: (async () => ({})) as never,
      loginImpl: vi.fn() as never,
      writeImpl: () => undefined,
    });

    expect(result.status).toBe("abort");
  });

  it("stops when the login itself fails", async () => {
    const result = await recoverExpiredSession({
      cfg,
      tool: "codex",
      isTTY: true,
      promptImpl: (async () => ({ confirmed: true })) as never,
      loginImpl: (async () => {
        throw new Error("device code expired");
      }) as never,
      writeImpl: () => undefined,
    });

    expect(result.status).toBe("abort");
    if (result.status !== "abort") throw new Error("unreachable");
    expect(result.message).toContain("device code expired");
  });

  it("stops when the login returns a config with no token", async () => {
    const result = await recoverExpiredSession({
      cfg,
      tool: "codex",
      isTTY: true,
      promptImpl: (async () => ({ confirmed: true })) as never,
      loginImpl: (async () => ({
        gateway_url: cfg.gateway_url,
        control_plane_url: cfg.control_plane_url,
      })) as never,
      writeImpl: () => undefined,
    });

    expect(result.status).toBe("abort");
  });
});

describe("expiredSessionHelp", () => {
  it("says the gateway was not used and why that matters", () => {
    const help = expiredSessionHelp("codex");
    expect(help).toContain("langwatch login --device");
    expect(help).toContain("gateway");
    expect(help).toContain("bills");
  });

  it("carries no em-dashes", () => {
    expect(expiredSessionHelp("claude")).not.toContain("—");
  });
});

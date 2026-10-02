/**
 * The browser project pick ends in a project-bound session; the CLI turns it into the key it
 * writes to .env.
 * Feature: specs/ai-governance/cli-onboarding/login-unified.feature
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pollUntilDone = vi.fn();
vi.mock("../device-flow", async () => {
  const actual = await vi.importActual<typeof deviceFlowModule>("../device-flow");
  return {
    ...actual,
    startDeviceCode: vi.fn(async () => ({
      device_code: "dc",
      user_code: "WDJB-MJHT",
      verification_uri: "https://app.langwatch.ai/cli/auth",
      expires_in: 600,
      interval: 5,
    })),
    pollUntilDone: (...args: unknown[]) => pollUntilDone(...args),
  };
});

vi.mock("../../spinner", () => ({
  createSpinner: vi.fn(() => {
    const spinner = {
      start: () => spinner,
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    };
    return spinner;
  }),
}));

vi.mock("../config", () => ({
  loadConfig: vi.fn(() => ({
    control_plane_url: "https://app.langwatch.ai",
    gateway_url: "https://gateway.langwatch.ai",
  })),
  saveConfig: vi.fn(),
  displayConfigPath: () => "~/.langwatch/config.json",
}));

vi.mock("../../identityNotice", () => ({
  rememberProjectName: vi.fn(),
}));

import type * as deviceFlowModule from "../device-flow";
import { runUnifiedLoginFlow } from "../login-flow";

const PROJECT = { id: "p1", slug: "demo", name: "Demo" };

function controlPlane({ projectKeyStatus }: { projectKeyStatus: number }) {
  const paths: string[] = [];
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const pathname = new URL(input instanceof Request ? input.url : input).pathname;
    paths.push(pathname);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (pathname === "/api/v1/api-keys/project") {
      return projectKeyStatus === 201
        ? json(201, { token: "sk-lw-project", apiKey: { id: "k1", name: "n" } })
        : json(projectKeyStatus, { error: "forbidden" });
    }
    if (pathname === "/api/v1/api-keys/ingestion") {
      return json(201, { token: "sk-lw-ingest", apiKey: { id: "k2", name: "n" } });
    }
    return json(200, { ok: true });
  });
  return { paths, fetchImpl };
}

describe("runUnifiedLoginFlow (project pick in the browser)", () => {
  let dir: string;
  const cwd = process.cwd();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-login-flow-"));
    process.chdir(dir);
    pollUntilDone.mockResolvedValue({
      kind: "project_session",
      access_token: "lw_at_project",
      refresh_token: "lw_rt_project",
      expires_in: 3600,
      project: PROJECT,
      user: { id: "u1", email: "dev@example.com", name: "Dev" },
      organization: { id: "o1", name: "Acme", slug: "acme" },
    });
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** @scenario The browser project pick writes the same full project key */
  it("writes the full project key minted with the picked project's session, then ends it", async () => {
    const { paths, fetchImpl } = controlPlane({ projectKeyStatus: 201 });
    vi.stubGlobal("fetch", fetchImpl);

    await runUnifiedLoginFlow({ kind: "project_api_key", browser: "none" });

    expect(paths).toContain("/api/v1/api-keys/project");
    expect(paths).not.toContain("/api/v1/api-keys/ingestion");
    expect(paths.at(-1)).toBe("/api/auth/cli/logout");
    expect(fs.readFileSync(path.join(dir, ".env"), "utf8")).toContain(
      "LANGWATCH_API_KEY=sk-lw-project",
    );
  });

  /** @scenario The browser project pick writes the same full project key */
  it("writes the ingestion key for a person who cannot manage the picked project", async () => {
    const { paths, fetchImpl } = controlPlane({ projectKeyStatus: 403 });
    vi.stubGlobal("fetch", fetchImpl);

    await runUnifiedLoginFlow({ kind: "project_api_key", browser: "none" });

    expect(paths).toContain("/api/v1/api-keys/ingestion");
    expect(fs.readFileSync(path.join(dir, ".env"), "utf8")).toContain(
      "LANGWATCH_API_KEY=sk-lw-ingest",
    );
    const printed = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls
      .flat()
      .join("\n");
    expect(printed).toContain("only sends traces");
  });
});

/**
 * Where the session context hook posts, and what authenticates the record.
 *
 * The environment comes first, per the OTel exporter spec, and cannot be the
 * only source: Claude Code strips every `OTEL_*` variable from the processes it
 * spawns, so a session exporting perfectly well hands its hooks an environment
 * with no endpoint in it at all. The CLI's own device config is the fallback,
 * and a CLI signed in with no key for this agent is a no-op rather than a guess.
 *
 * The config holds two credentials for one agent, and they are read in the
 * order `langwatch instrument` chooses between them: a tool pinned with
 * `--key` or `--project` reports with that key, to the endpoint the pin
 * carries, and the personal key is what an unpinned tool falls back on.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { describe, expect, it } from "vitest";

import {
  attributesOf,
  ENDPOINT,
  installHookHarness,
  SESSION_ID,
} from "./hook-harness";

const hook = installHookHarness();
const { posted } = hook;

const SESSION_ONLY = { session_id: SESSION_ID };

/** The key `langwatch instrument claude --key/--project` writes for the tool. */
const PINNED_KEY = "sk-lw-pinned_secret";

describe("the session context hook's telemetry target", () => {
  describe("given an OTLP endpoint in the environment", () => {
    it("posts to the logs path under it", async () => {
      await hook.runHook();

      expect(posted[0]!.url).toBe(`${ENDPOINT}/v1/logs`);
    });

    it("prefers the logs-specific endpoint variable when it is set", async () => {
      await hook.runHook({
        env: {
          OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://collector.example.com/logs",
        },
      });

      expect(posted[0]!.url).toBe("http://collector.example.com/logs");
    });

    it("prefers the environment over the CLI config when both name a collector", async () => {
      await hook.runHook({
        readCliConfig: () => ({
          control_plane_url: "http://fallback.example.com",
          default_personal_ingest_keys: {
            claude_code: { secret: "ik-lw-fallback" },
          },
        }),
      });

      expect(posted[0]!.url).toBe(`${ENDPOINT}/v1/logs`);
    });
  });

  describe("given no OTLP endpoint in the environment", () => {
    /** @scenario "Without telemetry configuration the hook sends nothing and exits zero" */
    it("posts nothing and exits zero when the CLI is not signed in either", async () => {
      await hook.runHook({ shouldOmitExporterEnv: true, input: SESSION_ONLY });

      expect(posted).toEqual([]);
      expect(hook.exits).toEqual([]);
    });

    /** @scenario "An agent that strips the exporter variables still reports" */
    it("falls back to the control plane and ingest key the CLI is signed in with", async () => {
      await hook.runHook({
        shouldOmitExporterEnv: true,
        input: SESSION_ONLY,
        env: { CLAUDE_PROJECT_DIR: "/repo/worktrees/review" },
        readCliConfig: () => ({
          control_plane_url: "http://app.example.com/",
          default_personal_ingest_keys: {
            claude_code: { secret: "ik-lw-abc_def" },
          },
        }),
      });

      expect(posted).toHaveLength(1);
      expect(posted[0]!.url).toBe("http://app.example.com/api/otel/v1/logs");
      expect(posted[0]!.headers.Authorization).toBe("Bearer ik-lw-abc_def");
      expect(attributesOf(posted[0]!)["vcs.repository.name"]).toBe("langwatch");
    });

    it("resolves its own agent's ingest key from the CLI config", async () => {
      await hook.runHook({
        tool: "codex",
        shouldOmitExporterEnv: true,
        readCliConfig: () => ({
          control_plane_url: "http://app.example.com",
          default_personal_ingest_keys: {
            claude_code: { secret: "ik-lw-claude" },
            codex: { secret: "ik-lw-codex" },
          },
        }),
      });

      expect(posted[0]!.headers.Authorization).toBe("Bearer ik-lw-codex");
    });

    /** @scenario "A signed-in CLI with no key for this agent sends nothing" */
    it("posts nothing when the config carries no ingest key for the agent", async () => {
      await hook.runHook({
        shouldOmitExporterEnv: true,
        input: SESSION_ONLY,
        readCliConfig: () => ({
          control_plane_url: "http://app.example.com",
          default_personal_ingest_keys: { codex: { secret: "ik-lw-other" } },
        }),
      });

      expect(posted).toEqual([]);
      expect(hook.exits).toEqual([]);
    });
  });

  describe("given a tool pinned with instrument --key or --project", () => {
    /** @scenario "A pinned tool posts its session context with the pinned key" */
    it("posts with the pinned key, which is the only one a pinned tool has", async () => {
      await hook.runHook({
        shouldOmitExporterEnv: true,
        readCliConfig: () => ({
          control_plane_url: "https://app.example.com",
          tool_project_keys: {
            claude: { secret: PINNED_KEY, project_id: "project-abc" },
          },
        }),
      });

      expect(posted).toHaveLength(1);
      expect(posted[0]!.url).toBe("https://app.example.com/api/otel/v1/logs");
      expect(posted[0]!.headers.Authorization).toBe(`Bearer ${PINNED_KEY}`);
      expect(attributesOf(posted[0]!)["vcs.repository.name"]).toBe("langwatch");
    });

    /** @scenario "The endpoint the pin carries wins over the control plane" */
    it("posts to the endpoint the pin carries, not the control plane", async () => {
      await hook.runHook({
        shouldOmitExporterEnv: true,
        readCliConfig: () => ({
          control_plane_url: "https://app.example.com",
          tool_project_keys: {
            claude: { secret: PINNED_KEY, endpoint: "https://pinned.example.com/" },
          },
        }),
      });

      expect(posted[0]!.url).toBe("https://pinned.example.com/api/otel/v1/logs");
    });

    /** @scenario "A tool with both a pin and a personal key uses the pin" */
    it("prefers the pin over a personal key left from an earlier setup", async () => {
      await hook.runHook({
        shouldOmitExporterEnv: true,
        readCliConfig: () => ({
          control_plane_url: "https://app.example.com",
          default_personal_ingest_keys: {
            claude_code: { secret: "ik-lw-personal" },
          },
          tool_project_keys: { claude: { secret: PINNED_KEY } },
        }),
      });

      expect(posted[0]!.headers.Authorization).toBe(`Bearer ${PINNED_KEY}`);
    });

    /** @scenario "A pin for another tool leaves this one on its personal key" */
    it("reads the pin under this tool's slug, not another tool's", async () => {
      await hook.runHook({
        shouldOmitExporterEnv: true,
        readCliConfig: () => ({
          control_plane_url: "https://app.example.com",
          default_personal_ingest_keys: {
            claude_code: { secret: "ik-lw-personal" },
          },
          tool_project_keys: { codex: { secret: PINNED_KEY } },
        }),
      });

      expect(posted[0]!.headers.Authorization).toBe("Bearer ik-lw-personal");
    });

    /** @scenario "A pin to a loopback endpoint over http still reports" */
    it("posts to a loopback pin over plain http, which local development runs on", async () => {
      await hook.runHook({
        shouldOmitExporterEnv: true,
        readCliConfig: () => ({
          control_plane_url: "https://app.example.com",
          tool_project_keys: {
            claude: { secret: PINNED_KEY, endpoint: "http://localhost:5570" },
          },
        }),
      });

      expect(posted[0]!.url).toBe("http://localhost:5570/api/otel/v1/logs");
      expect(posted[0]!.headers.Authorization).toBe(`Bearer ${PINNED_KEY}`);
    });

    /** @scenario "A pin on a CLI that names no control plane sends nothing" */
    it("posts nothing when neither the pin nor the config names a collector", async () => {
      await hook.runHook({
        shouldOmitExporterEnv: true,
        input: SESSION_ONLY,
        readCliConfig: () => ({
          default_personal_ingest_keys: {
            claude_code: { secret: "ik-lw-personal" },
          },
          tool_project_keys: { claude: { secret: PINNED_KEY } },
        }),
      });

      expect(posted).toEqual([]);
      expect(hook.exits).toEqual([]);
    });
  });
});

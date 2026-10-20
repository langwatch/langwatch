/**
 * The session context hook run by Copilot, from the payloads the CLI and VS
 * Code Copilot Chat really send (ADR-039 S4).
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { describe, expect, it, vi } from "vitest";

import { attributesOf, installHookHarness } from "./hook-harness";
import captured from "./fixtures/copilot-hook-payloads.json";

const hook = installHookHarness();
const { posted } = hook;

const cli = captured["copilot-cli"];
const vscode = captured["copilot-vscode"];

/** The CLI marks every hook it runs; VS Code sets no such variable. */
const CLI_ENV = { COPILOT_CLI: "1" };

/** A signed-in CLI holding a personal key for each Copilot surface. */
const BOTH_SURFACES = () => ({
  control_plane_url: "https://app.example.com",
  default_personal_ingest_keys: {
    copilot_cli: { secret: "ik-lw-copilot-cli" },
    copilot_vscode: { secret: "ik-lw-copilot-vscode" },
  },
});

describe("the session context hook run by Copilot", () => {
  describe("given a Copilot hook invocation inside a git repository", () => {
    /** @scenario "The copilot record declares the copilot agent and the span session id" */
    it.each([
      ["the Copilot CLI", cli.sessionStart, cli.sessionStart.sessionId, CLI_ENV],
      ["VS Code", vscode.sessionStart, vscode.sessionStart.session_id, {}],
    ])("posts one record from %s declaring copilot and the payload's session id", async (
      _surface,
      input,
      sessionId,
      env,
    ) => {
      await hook.runHook({ tool: "copilot", input, env });

      expect(posted).toHaveLength(1);
      expect(attributesOf(posted[0]!)).toMatchObject({
        "coding_agent.name": "copilot",
        // The hook session id is the conversation id on Copilot's spans
        // (#8803 Q4), so this record lands on the row the spans built.
        "session.id": sessionId,
        "vcs.repository.name": "langwatch",
        "vcs.ref.head.name": "feat/session-context",
      });
    });

    it("writes nothing on stdout and asks for no exit code", async () => {
      await hook.runHook({ tool: "copilot", input: cli.agentStop, env: CLI_ENV });

      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });

    it("reads the directory from the payload, not from where the CLI was launched", async () => {
      const directories: string[] = [];
      await hook.runHook({
        tool: "copilot",
        input: cli.sessionStart,
        env: { ...CLI_ENV, COPILOT_PROJECT_DIR: "/home/dev/work/launched-here" },
        runGit: ({ args, cwd }) => {
          directories.push(cwd);
          return args.join(" ") === "remote get-url origin"
            ? "git@github.com:langwatch/langwatch.git"
            : null;
        },
      });

      expect(new Set(directories)).toEqual(new Set([cli.sessionStart.cwd]));
    });
  });

  describe("given personal ingest keys for copilot_cli and copilot_vscode", () => {
    /** @scenario "A Copilot hook posts with the personal key of the surface that ran it" */
    it("posts the CLI's record with the copilot_cli key and VS Code's with the copilot_vscode key", async () => {
      await hook.runHook({
        tool: "copilot",
        input: cli.sessionStart,
        env: CLI_ENV,
        shouldOmitExporterEnv: true,
        readCliConfig: BOTH_SURFACES,
      });
      await hook.runHook({
        tool: "copilot",
        input: vscode.sessionStart,
        shouldOmitExporterEnv: true,
        readCliConfig: BOTH_SURFACES,
      });

      expect(posted.map((request) => request.headers.Authorization)).toEqual([
        "Bearer ik-lw-copilot-cli",
        "Bearer ik-lw-copilot-vscode",
      ]);
      expect(posted[0]!.url).toBe("https://app.example.com/api/otel/v1/logs");
    });

    it("posts nothing from a surface whose own key is missing, rather than borrow the other's", async () => {
      await hook.runHook({
        tool: "copilot",
        input: vscode.sessionStart,
        shouldOmitExporterEnv: true,
        readCliConfig: () => ({
          control_plane_url: "https://app.example.com",
          default_personal_ingest_keys: { copilot_cli: { secret: "ik-lw-copilot-cli" } },
        }),
      });

      expect(posted).toEqual([]);
    });

    it("posts with the pin of the surface's tool slug when one stands", async () => {
      await hook.runHook({
        tool: "copilot",
        input: vscode.sessionStart,
        shouldOmitExporterEnv: true,
        readCliConfig: () => ({
          ...BOTH_SURFACES(),
          tool_project_keys: {
            copilot: { secret: "sk-lw-pinned-copilot", project_id: "project-cli" },
            code: { secret: "sk-lw-pinned-code", project_id: "project-vscode" },
          },
        }),
      });

      expect(posted[0]!.headers.Authorization).toBe("Bearer sk-lw-pinned-code");
    });
  });

  describe("given a collector that rejects the surface's personal key", () => {
    it("hands the healer that surface's source type and stays silent on stdout", async () => {
      const healRevokedKey = vi.fn().mockResolvedValue({ status: "declined" });

      await hook.runHook({
        tool: "copilot",
        input: cli.sessionStart,
        env: CLI_ENV,
        shouldOmitExporterEnv: true,
        readCliConfig: BOTH_SURFACES,
        fetchImpl: hook.collector(401),
        healRevokedKey,
      });

      expect(healRevokedKey).toHaveBeenCalledWith({
        sourceType: "copilot_cli",
        rejectedToken: "ik-lw-copilot-cli",
      });
      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });
  });
});

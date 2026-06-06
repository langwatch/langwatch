/**
 * Unit tests for the runtime path-selection UX of `langwatch <tool>`.
 *
 * Covers the decision tree (override flag / env, remembered pref,
 * single-allowed-path, both-allowed prompt, non-TTY default) and the
 * `--tool-mode` arg-strip that keeps the wrapper flag out of the child's
 * argv. The prompt + config-save are injected seams, so no module mock
 * or filesystem touch is needed.
 */
import { describe, it, expect, vi } from "vitest";

import type { GovernanceConfig } from "../config";
import {
  parseToolModeFlag,
  resolveWrapperPath,
  pathChoiceMessage,
  gatewayChoiceTitle,
  otlpChoiceTitle,
} from "../wrapper-path-choice";

function baseCfg(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    gateway_url: "http://gw.example.com",
    control_plane_url: "http://app.example.com",
    access_token: "tok",
    organization: { id: "o1", slug: "acme" },
    ...overrides,
  };
}

/** A prompts() stub that returns a fixed selection and records the call. */
function selectingPrompt(value: "gateway" | "ingestion") {
  return vi.fn(async () => ({ path: value })) as unknown as Parameters<
    typeof resolveWrapperPath
  >[0]["promptImpl"];
}

const neverPrompt = vi.fn(async () => {
  throw new Error("prompt should not have been called");
}) as unknown as Parameters<typeof resolveWrapperPath>[0]["promptImpl"];

describe("parseToolModeFlag", () => {
  describe("given no wrapper flag is present", () => {
    it("forwards every arg verbatim in order with no override", () => {
      const input = ["--dangerously-skip-permissions", "-p", "say hi"];
      const out = parseToolModeFlag(input, {});
      expect(out.args).toEqual([
        "--dangerously-skip-permissions",
        "-p",
        "say hi",
      ]);
      expect(out.override).toBeUndefined();
    });
  });

  describe("given --tool-mode=otlp in the args", () => {
    /** @scenario "--tool-mode=otlp forces ingestion and is not forwarded to the tool" */
    it("strips the flag and resolves the ingestion override, order preserved", () => {
      const input = ["--tool-mode=otlp", "-p", "hi"];
      const out = parseToolModeFlag(input, {});
      expect(out.args).toEqual(["-p", "hi"]);
      expect(out.override).toBe("ingestion");
    });

    /** @scenario "--tool-mode=gateway forces the gateway path" */
    it("strips the flag from the MIDDLE without disturbing surrounding args", () => {
      const input = [
        "--dangerously-skip-permissions",
        "--tool-mode=gateway",
        "-p",
        "hi there",
      ];
      const out = parseToolModeFlag(input, {});
      expect(out.args).toEqual([
        "--dangerously-skip-permissions",
        "-p",
        "hi there",
      ]);
      expect(out.override).toBe("gateway");
    });
  });

  describe("given the space-separated --tool-mode otlp form", () => {
    it("consumes both the flag and its value token", () => {
      const input = ["--tool-mode", "otlp", "--print", "x"];
      const out = parseToolModeFlag(input, {});
      expect(out.args).toEqual(["--print", "x"]);
      expect(out.override).toBe("ingestion");
    });
  });

  describe("given LANGWATCH_TOOL_MODE env and no flag", () => {
    /** @scenario "LANGWATCH_TOOL_MODE=otlp forces ingestion without a flag" */
    it("reads the override from the env", () => {
      const out = parseToolModeFlag(["-p", "hi"], { LANGWATCH_TOOL_MODE: "otlp" });
      expect(out.args).toEqual(["-p", "hi"]);
      expect(out.override).toBe("ingestion");
    });

    it("lets the flag win over the env", () => {
      const out = parseToolModeFlag(["--tool-mode=otlp"], {
        LANGWATCH_TOOL_MODE: "gateway",
      });
      expect(out.override).toBe("ingestion");
    });
  });
});

describe("resolveWrapperPath", () => {
  describe("when an explicit override is set", () => {
    it("uses otlp without prompting", async () => {
      const out = await resolveWrapperPath({
        cfg: baseCfg(),
        tool: "claude",
        args: ["-p", "hi"],
        override: "ingestion",
        isTTY: true,
        promptImpl: neverPrompt,
        env: {},
      });
      expect(out.mode).toBe("ingestion");
      expect(out.prompted).toBe(false);
    });
  });

  describe("when a preference is already remembered", () => {
    /** @scenario "A pinned tool_mode is honored with no prompt" */
    it("honors the pinned tool_mode without prompting", async () => {
      const out = await resolveWrapperPath({
        cfg: baseCfg({ tool_mode: { claude: "ingestion" } }),
        tool: "claude",
        args: [],
        isTTY: true,
        promptImpl: neverPrompt,
        env: {},
      });
      expect(out.mode).toBe("ingestion");
      expect(out.prompted).toBe(false);
    });
  });

  describe("when exactly one path is allowed by policy", () => {
    /** @scenario "Only the gateway path is allowed" */
    it("uses the gateway silently when direct OTLP is disabled", async () => {
      const out = await resolveWrapperPath({
        cfg: baseCfg({
          tool_policies: { claude: { allowVk: true, allowOtelDirect: false } },
        }),
        tool: "claude",
        args: [],
        isTTY: true,
        promptImpl: neverPrompt,
        env: {},
      });
      expect(out.mode).toBe("gateway");
      expect(out.prompted).toBe(false);
    });

    /** @scenario "Only the direct OTLP path is allowed" */
    it("uses ingestion silently when the gateway path is disabled", async () => {
      const out = await resolveWrapperPath({
        cfg: baseCfg({
          tool_policies: { claude: { allowVk: false, allowOtelDirect: true } },
        }),
        tool: "claude",
        args: [],
        isTTY: true,
        promptImpl: neverPrompt,
        env: {},
      });
      expect(out.mode).toBe("ingestion");
      expect(out.prompted).toBe(false);
    });
  });

  describe("when both paths are allowed", () => {
    describe("when stdin/stdout is a TTY and nothing is remembered", () => {
      /** @scenario "First interactive run with both paths allowed prompts for the path" */
      it("prompts and remembers the gateway choice", async () => {
        const save = vi.fn();
        const write = vi.fn();
        // Capturing prompt so we can assert the select offered both paths.
        const prompt = vi.fn(async () => ({
          path: "gateway",
        })) as unknown as Parameters<typeof resolveWrapperPath>[0]["promptImpl"];
        const cfg = baseCfg();
        const out = await resolveWrapperPath({
          cfg,
          tool: "claude",
          args: [],
          isTTY: true,
          promptImpl: prompt,
          saveImpl: save,
          writeImpl: write,
          env: {},
        });
        expect(out.mode).toBe("gateway");
        expect(out.prompted).toBe(true);
        // The select asked how the tool should run and offered both paths.
        const promptArg = (prompt as unknown as ReturnType<typeof vi.fn>).mock
          .calls[0]![0] as {
          message: string;
          choices: Array<{ title: string; value: string }>;
        };
        expect(promptArg.message).toBe("How should `langwatch claude` run?");
        const values = promptArg.choices.map((c) => c.value);
        expect(values).toEqual(["gateway", "ingestion"]);
        const titles = promptArg.choices.map((c) => c.title).join(" | ");
        expect(titles).toContain("Gateway (virtual key)");
        expect(titles).toContain("Direct OTLP");
        // Remembered for next time.
        expect(save).toHaveBeenCalledTimes(1);
        const persisted = save.mock.calls[0]![0] as GovernanceConfig;
        expect(persisted.tool_mode?.claude).toBe("gateway");
        // tip mentions how to override + where it's stored.
        const tip = write.mock.calls.map((c) => c[0]).join("");
        expect(tip).toContain("--tool-mode=otlp");
        expect(tip).toContain("config.json");
      });

      /** @scenario "Choosing direct OTLP remembers it as ingestion" */
      it("prompts and remembers the otlp choice as ingestion", async () => {
        const save = vi.fn();
        const out = await resolveWrapperPath({
          cfg: baseCfg(),
          tool: "claude",
          args: [],
          isTTY: true,
          promptImpl: selectingPrompt("ingestion"),
          saveImpl: save,
          writeImpl: vi.fn(),
          env: {},
        });
        expect(out.mode).toBe("ingestion");
        expect(out.prompted).toBe(true);
        const persisted = save.mock.calls[0]![0] as GovernanceConfig;
        expect(persisted.tool_mode?.claude).toBe("ingestion");
      });

      /** @scenario "Choosing the gateway remembers it and does not prompt again" */
      it("does not prompt on the next run after the gateway choice is remembered", async () => {
        // First run: pick gateway. The choice is written back onto the
        // same cfg object (cfg.tool_mode is mutated in place).
        const cfg = baseCfg();
        const first = await resolveWrapperPath({
          cfg,
          tool: "claude",
          args: [],
          isTTY: true,
          promptImpl: selectingPrompt("gateway"),
          saveImpl: vi.fn(),
          writeImpl: vi.fn(),
          env: {},
        });
        expect(first.mode).toBe("gateway");
        expect(first.prompted).toBe(true);
        expect(cfg.tool_mode?.claude).toBe("gateway");

        // Second run on the same (now-pinned) cfg: no prompt.
        const second = await resolveWrapperPath({
          cfg,
          tool: "claude",
          args: [],
          isTTY: true,
          promptImpl: neverPrompt,
          env: {},
        });
        expect(second.mode).toBe("gateway");
        expect(second.prompted).toBe(false);
      });
    });

    describe("when stdin is not a TTY", () => {
      /** @scenario "Non-TTY defaults to the gateway" */
      it("defaults to the gateway without prompting or persisting", async () => {
        const save = vi.fn();
        const out = await resolveWrapperPath({
          cfg: baseCfg(),
          tool: "claude",
          args: [],
          isTTY: false,
          promptImpl: neverPrompt,
          saveImpl: save,
          env: {},
        });
        expect(out.mode).toBe("gateway");
        expect(out.prompted).toBe(false);
        expect(save).not.toHaveBeenCalled();
      });
    });

    describe("when LANGWATCH_AUTO_LOGIN is forced on", () => {
      /** @scenario "LANGWATCH_AUTO_LOGIN skips the prompt" */
      it("defaults to the gateway even on a TTY", async () => {
        const out = await resolveWrapperPath({
          cfg: baseCfg(),
          tool: "claude",
          args: [],
          isTTY: true,
          promptImpl: neverPrompt,
          env: { LANGWATCH_AUTO_LOGIN: "1" },
        });
        expect(out.mode).toBe("gateway");
        expect(out.prompted).toBe(false);
      });
    });

    describe("when the user aborts the prompt", () => {
      it("falls back to the gateway for this run without persisting", async () => {
        const save = vi.fn();
        const abortPrompt = vi.fn(async () => ({})) as unknown as Parameters<
          typeof resolveWrapperPath
        >[0]["promptImpl"];
        const out = await resolveWrapperPath({
          cfg: baseCfg(),
          tool: "claude",
          args: [],
          isTTY: true,
          promptImpl: abortPrompt,
          saveImpl: save,
          env: {},
        });
        expect(out.mode).toBe("gateway");
        expect(out.prompted).toBe(false);
        expect(save).not.toHaveBeenCalled();
      });
    });
  });

  describe("prompt copy", () => {
    it("asks how the tool should run and names both paths", () => {
      expect(pathChoiceMessage("claude")).toBe(
        "How should `langwatch claude` run?",
      );
      expect(gatewayChoiceTitle()).toContain("Gateway (virtual key)");
      expect(gatewayChoiceTitle()).toContain("billed to the gateway");
      expect(otlpChoiceTitle("claude")).toContain("Direct OTLP");
      expect(otlpChoiceTitle("claude")).toContain("your own claude plan");
    });
  });
});

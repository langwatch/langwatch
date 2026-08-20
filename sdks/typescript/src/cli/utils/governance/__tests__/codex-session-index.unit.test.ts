/**
 * Reading codex's own session names out of its session_index.jsonl — the
 * names `codex resume <name>` resolves, mirrored instead of invented.
 *
 * Feature: specs/ai-governance/cli-wrappers/codex-rollout-io.feature
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  codexSessionIndexPath,
  readCodexThreadNames,
} from "../codex-session-index";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "lw-codex-index-"));
  mkdirSync(join(home, "sessions"), { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const indexLine = (id: string, name: string) =>
  JSON.stringify({ id, thread_name: name, updated_at: "2026-08-02T10:00:00Z" });

describe("the codex session index", () => {
  it("lives beside the sessions tree, not inside it", () => {
    expect(codexSessionIndexPath(join(home, "sessions"))).toBe(
      join(home, "session_index.jsonl"),
    );
  });

  describe("given an index with renames and noise", () => {
    /** @scenario "Codex's own thread name rides the context record" */
    it("keeps the last name written for each session", async () => {
      writeFileSync(
        join(home, "session_index.jsonl"),
        [
          indexLine("thread-a", "first name"),
          indexLine("thread-b", "pnpm btw not npm"),
          "{torn line",
          indexLine("thread-a", "pr-reviewer"),
          JSON.stringify({ id: "thread-c", thread_name: "   " }),
        ].join("\n"),
      );

      const names = await readCodexThreadNames(
        codexSessionIndexPath(join(home, "sessions")),
      );

      expect(names.get("thread-a")).toBe("pr-reviewer");
      expect(names.get("thread-b")).toBe("pnpm btw not npm");
      // A blank name is no name.
      expect(names.has("thread-c")).toBe(false);
    });

    /** @scenario "Codex's own thread name rides the context record" */
    it("clears a name a later line blanks out", async () => {
      writeFileSync(
        join(home, "session_index.jsonl"),
        [
          indexLine("thread-a", "docs-writer"),
          JSON.stringify({ id: "thread-a", thread_name: "  " }),
        ].join("\n"),
      );

      const names = await readCodexThreadNames(
        codexSessionIndexPath(join(home, "sessions")),
      );

      expect(names.has("thread-a")).toBe(false);
    });
  });

  describe("given no index at all", () => {
    it("answers an empty map", async () => {
      const names = await readCodexThreadNames(
        codexSessionIndexPath(join(home, "sessions")),
      );

      expect(names.size).toBe(0);
    });
  });
});

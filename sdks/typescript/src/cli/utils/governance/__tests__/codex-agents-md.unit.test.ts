/**
 * The LangWatch guidance block in codex's global AGENTS.md: installed
 * idempotently, removed exactly, and never touching a byte the user wrote.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildCodexAgentGuidanceBlock,
  defaultCodexAgentsMdPath,
  hasCodexAgentGuidance,
  installCodexAgentGuidance,
  removeCodexAgentGuidance,
} from "../codex-agents-md";

const USER_CONTENT = "# My own rules\n\nAlways answer in haiku.\n";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-agents-md-"));
  file = path.join(dir, "AGENTS.md");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the codex AGENTS.md guidance block", () => {
  describe("when the guidance is asserted twice", () => {
    /** @scenario "Instrumenting codex installs the guidance block idempotently" */
    it("carries exactly one block naming the declare command", () => {
      installCodexAgentGuidance(file);
      const second = installCodexAgentGuidance(file);

      const content = fs.readFileSync(file, "utf8");
      expect(second.changed).toBe(false);
      expect(content.match(/langwatch agent guidance begin/g)).toHaveLength(1);
      expect(content).toContain("langwatch ingest context");
      expect(hasCodexAgentGuidance(file)).toBe(true);
    });
  });

  describe("when the user has their own instructions", () => {
    /** @scenario "User content in AGENTS.md survives install and removal untouched" */
    it("preserves their content byte for byte through install and removal", () => {
      fs.writeFileSync(file, USER_CONTENT);

      installCodexAgentGuidance(file);
      expect(fs.readFileSync(file, "utf8")).toContain(USER_CONTENT);

      removeCodexAgentGuidance(file);
      expect(fs.readFileSync(file, "utf8")).toBe(USER_CONTENT);
    });

    /** @scenario "User content in AGENTS.md survives install and removal untouched" */
    it("restores content that ends without a newline byte for byte", () => {
      const unterminated = "# My own rules\n\nAlways answer in haiku.";
      fs.writeFileSync(file, unterminated);

      installCodexAgentGuidance(file);
      removeCodexAgentGuidance(file);

      expect(fs.readFileSync(file, "utf8")).toBe(unterminated);
    });

    it("keeps content written below the block when replacing it", () => {
      installCodexAgentGuidance(file);
      fs.appendFileSync(file, "\n# Added later by the user\n");

      installCodexAgentGuidance(file);

      const content = fs.readFileSync(file, "utf8");
      expect(content).toContain("# Added later by the user");
      expect(content.match(/langwatch agent guidance begin/g)).toHaveLength(1);
    });
  });

  describe("when logout removes the guidance", () => {
    /** @scenario "Logout removes exactly the LangWatch AGENTS.md block" */
    it("removes the block and keeps the user's content", () => {
      fs.writeFileSync(file, USER_CONTENT);
      installCodexAgentGuidance(file);

      removeCodexAgentGuidance(file);

      expect(fs.readFileSync(file, "utf8")).toContain("Always answer in haiku.");
      expect(hasCodexAgentGuidance(file)).toBe(false);
    });

    /** @scenario "An AGENTS.md we created and emptied is removed entirely" */
    it("deletes a file that held nothing but the block", () => {
      installCodexAgentGuidance(file);

      removeCodexAgentGuidance(file);

      expect(fs.existsSync(file)).toBe(false);
    });

    it("leaves a file without the block alone", () => {
      fs.writeFileSync(file, USER_CONTENT);

      removeCodexAgentGuidance(file);

      expect(fs.readFileSync(file, "utf8")).toBe(USER_CONTENT);
    });
  });

  describe("when only half a marker pair is in the file", () => {
    it("reports no guidance, the same region removal accepts", () => {
      fs.writeFileSync(file, `${USER_CONTENT}\n<!-- >>> langwatch agent guidance begin >>> -->\n`);

      expect(hasCodexAgentGuidance(file)).toBe(false);
      expect(removeCodexAgentGuidance(file)).toBe(false);
    });
  });

  describe("when the file cannot be read for a reason other than being absent", () => {
    it("fails instead of replacing it with the block alone", () => {
      fs.mkdirSync(file);

      expect(() => installCodexAgentGuidance(file)).toThrow();
      expect(fs.statSync(file).isDirectory()).toBe(true);
    });
  });

  describe("when CODEX_HOME points somewhere else", () => {
    it("resolves the AGENTS.md under it", () => {
      const previous = process.env.CODEX_HOME;
      process.env.CODEX_HOME = dir;
      try {
        expect(defaultCodexAgentsMdPath()).toBe(path.join(dir, "AGENTS.md"));
      } finally {
        if (previous === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = previous;
      }
    });
  });

  describe("the block itself", () => {
    it("renders nothing of its own as markdown structure", () => {
      const block = buildCodexAgentGuidanceBlock();
      for (const line of block.split("\n")) {
        expect(line.startsWith("#")).toBe(false);
      }
    });
  });
});

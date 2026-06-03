import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildCodexOtelBlock,
  writeCodexOtelBlock,
} from "../codex-config-toml";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lw-codex-toml-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("buildCodexOtelBlock", () => {
  it("emits the [otel] block bracketed by langwatch markers", () => {
    const out = buildCodexOtelBlock({
      endpoint: "https://app.langwatch.ai/api/otel",
      ingestionToken: "ik-lw-xxx",
    });
    expect(out).toContain("# >>> langwatch otel begin >>>");
    expect(out).toContain("# <<< langwatch otel end <<<");
    expect(out).toContain("[otel]");
    expect(out).toContain("[otel.exporter.otlp-http]");
    expect(out).toContain(`endpoint = "https://app.langwatch.ai/api/otel"`);
    expect(out).toContain(`protocol = "json"`);
  });

  it("does NOT persist the Authorization header in the toml file", () => {
    const out = buildCodexOtelBlock({
      endpoint: "https://app.langwatch.ai/api/otel",
      ingestionToken: "ik-lw-SECRET-NOT-FOR-DISK",
    });
    expect(out).not.toContain("ik-lw-SECRET-NOT-FOR-DISK");
  });
});

describe("writeCodexOtelBlock", () => {
  describe("when the file does not exist", () => {
    it("creates the parent dir + writes the block as the file contents", () => {
      const filePath = path.join(tmp, "subdir", "config.toml");
      const result = writeCodexOtelBlock(
        {
          endpoint: "http://localhost:5560/api/otel",
          ingestionToken: "ik-lw-zzz",
        },
        { filePath },
      );

      expect(result.action).toBe("created");
      expect(result.path).toBe(filePath);
      const contents = fs.readFileSync(filePath, "utf8");
      expect(contents).toContain("[otel]");
      expect(contents).toContain("# >>> langwatch otel begin >>>");
    });
  });

  describe("when the file exists without the marker block", () => {
    it("appends the block + leaves prior content untouched", () => {
      const filePath = path.join(tmp, "config.toml");
      const prior = `model = "gpt-5"\npersonality = "pragmatic"\n`;
      fs.writeFileSync(filePath, prior);

      const result = writeCodexOtelBlock(
        {
          endpoint: "http://localhost:5560/api/otel",
          ingestionToken: "ik-lw-zzz",
        },
        { filePath },
      );

      expect(result.action).toBe("updated");
      const contents = fs.readFileSync(filePath, "utf8");
      expect(contents.startsWith(prior)).toBe(true);
      expect(contents).toContain("# >>> langwatch otel begin >>>");
      expect(contents).toContain("[otel.exporter.otlp-http]");
    });
  });

  describe("when the file already has a langwatch marker block", () => {
    it("regex-replaces the bracketed region without doubling up", () => {
      const filePath = path.join(tmp, "config.toml");
      writeCodexOtelBlock(
        {
          endpoint: "http://localhost:5560/api/otel",
          ingestionToken: "ik-lw-zzz",
        },
        { filePath },
      );

      const result = writeCodexOtelBlock(
        {
          endpoint: "https://app.langwatch.ai/api/otel",
          ingestionToken: "ik-lw-zzz",
        },
        { filePath },
      );

      expect(result.action).toBe("updated");
      const contents = fs.readFileSync(filePath, "utf8");
      const beginCount = (contents.match(/langwatch otel begin/g) ?? []).length;
      expect(beginCount).toBe(1);
      expect(contents).toContain("https://app.langwatch.ai/api/otel");
      expect(contents).not.toContain("http://localhost:5560/api/otel");
    });

    it("reports 'unchanged' when re-run with the same inputs", () => {
      const filePath = path.join(tmp, "config.toml");
      const inputs = {
        endpoint: "https://app.langwatch.ai/api/otel",
        ingestionToken: "ik-lw-zzz",
      };
      writeCodexOtelBlock(inputs, { filePath });
      const result = writeCodexOtelBlock(inputs, { filePath });
      expect(result.action).toBe("unchanged");
    });
  });

  describe("when the file has unrelated content with TOML sections", () => {
    /**
     * Guards against a regex that would over-match into adjacent
     * sections. The marker pair must be the only thing the merger
     * touches; codex's own [projects.*] / [tui.*] sections stay
     * verbatim.
     */
    it("preserves adjacent codex sections byte-for-byte", () => {
      const filePath = path.join(tmp, "config.toml");
      const prior = [
        `model = "gpt-5"`,
        ``,
        `[projects."/Users/x/foo"]`,
        `trust_level = "trusted"`,
        ``,
        `[tui.model_availability_nux]`,
        `"gpt-5" = 4`,
        ``,
      ].join("\n");
      fs.writeFileSync(filePath, prior);

      writeCodexOtelBlock(
        {
          endpoint: "http://localhost:5560/api/otel",
          ingestionToken: "ik-lw-zzz",
        },
        { filePath },
      );

      const contents = fs.readFileSync(filePath, "utf8");
      expect(contents).toContain(`[projects."/Users/x/foo"]`);
      expect(contents).toContain(`[tui.model_availability_nux]`);
      expect(contents).toContain(`trust_level = "trusted"`);
    });
  });
});

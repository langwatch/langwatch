import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setOpencodeOpenTelemetryFlag } from "../opencode-config-flag";

let tmp: string;
let configPath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lw-opencode-flag-"));
  configPath = path.join(tmp, "opencode.jsonc");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("setOpencodeOpenTelemetryFlag", () => {
  it("creates a fresh config with the flag set when the file does not exist", () => {
    const result = setOpencodeOpenTelemetryFlag({ filePath: configPath });
    expect(result.action).toBe("created");
    expect(result.path).toBe(configPath);
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.experimental.openTelemetry).toBe(true);
    expect(parsed.$schema).toBe("https://opencode.ai/config.json");
  });

  it("merges into an existing config without losing other top-level keys", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        username: "rchaves",
        agent: {},
      }),
    );
    const result = setOpencodeOpenTelemetryFlag({ filePath: configPath });
    expect(result.action).toBe("updated");
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.experimental.openTelemetry).toBe(true);
    expect(parsed.username).toBe("rchaves");
    expect(parsed.agent).toEqual({});
  });

  it("merges into an existing experimental block without dropping sibling experimental flags", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        experimental: { workspace: true, prefetchInRender: false },
      }),
    );
    setOpencodeOpenTelemetryFlag({ filePath: configPath });
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.experimental.openTelemetry).toBe(true);
    expect(parsed.experimental.workspace).toBe(true);
    expect(parsed.experimental.prefetchInRender).toBe(false);
  });

  it("returns unchanged + does not rewrite when the flag is already true", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ experimental: { openTelemetry: true } }),
    );
    const before = fs.readFileSync(configPath, "utf8");
    const result = setOpencodeOpenTelemetryFlag({ filePath: configPath });
    expect(result.action).toBe("unchanged");
    expect(fs.readFileSync(configPath, "utf8")).toBe(before);
  });

  it("refuses to overwrite when the user explicitly disabled the flag", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ experimental: { openTelemetry: false } }),
    );
    const result = setOpencodeOpenTelemetryFlag({ filePath: configPath });
    expect(result.action).toBe("disabled-by-user");
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.experimental.openTelemetry).toBe(false);
  });

  it("survives JSONC line + block comments in the existing config", () => {
    fs.writeFileSync(
      configPath,
      [
        "// top-level comment",
        "{",
        '  "$schema": "https://opencode.ai/config.json",',
        "  /* block",
        "     comment */",
        '  "agent": {}',
        "}",
      ].join("\n"),
    );
    const result = setOpencodeOpenTelemetryFlag({ filePath: configPath });
    expect(result.action).toBe("updated");
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.experimental.openTelemetry).toBe(true);
    expect(parsed.agent).toEqual({});
  });

  it("treats an unparseable existing file as a fresh slate", () => {
    fs.writeFileSync(configPath, "this is not json at all");
    const result = setOpencodeOpenTelemetryFlag({ filePath: configPath });
    expect(result.action).toBe("updated");
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.experimental.openTelemetry).toBe(true);
  });
});

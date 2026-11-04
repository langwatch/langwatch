/**
 * Grok's environment: the env block the wrapper injects and `instrument`
 * persists, and what `instrument grok` and logout leave on disk.
 * @see specs/ai-governance/cli-wrappers/grok-env-injection.feature
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTelemetryWiring } from "../instrument-wiring";
import { buildOtelEnvBlock, SOURCE_TYPE_BY_TOOL, TOOL_BY_SOURCE_TYPE } from "../otel-env-block";
import { scanTelemetryTargets } from "../telemetry-targets";
import { baseCfg, installTempHomeAndCwd } from "./telemetry-refresh-test-helpers";

const ENDPOINT = "http://app.example.com/api/otel";
const TOKEN = "ik-lw-grok000000000000_secret";

describe("buildOtelEnvBlock for grok", () => {
  const block = buildOtelEnvBlock("grok", ENDPOINT, TOKEN);

  /** @scenario The env block enables Grok's external exporter for logs and metrics */
  it("turns Grok's external exporter on for logs and metrics, pointed at LangWatch", () => {
    expect(block).toMatchObject({
      GROK_EXTERNAL_OTEL: "1",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${TOKEN}`,
    });
  });

  /** @scenario The env block turns every content gate on */
  it("turns every content gate on", () => {
    expect(block).toMatchObject({
      OTEL_LOG_USER_PROMPTS: "1",
      OTEL_LOG_ASSISTANT_RESPONSES: "1",
      OTEL_LOG_TOOL_DETAILS: "1",
      OTEL_LOG_TOOL_CONTENT: "1",
    });
  });

  /** @scenario The env block sets no traces exporter and no resource attributes */
  it("sets no traces exporter and no resource attributes", () => {
    expect(block).not.toHaveProperty("OTEL_TRACES_EXPORTER");
    expect(block).not.toHaveProperty("OTEL_RESOURCE_ATTRIBUTES");
  });

  /** @scenario The grok tool's key is minted for the grok_cli source type */
  it("maps the grok tool to grok_cli and back", () => {
    expect(SOURCE_TYPE_BY_TOOL.grok).toBe("grok_cli");
    expect(TOOL_BY_SOURCE_TYPE.grok_cli).toBe("grok");
  });
});

describe("instrumenting grok", () => {
  const temp = installTempHomeAndCwd();
  let origShell: string | undefined;
  const rcFile = () => path.join(temp.home, ".zshrc");
  const hookFile = () => path.join(temp.home, ".grok", "hooks", "langwatch.json");
  const instrument = () =>
    installTelemetryWiring({ cfg: baseCfg(), tool: "grok", endpoint: ENDPOINT, token: TOKEN });

  beforeEach(() => {
    origShell = process.env.SHELL;
    process.env.SHELL = "/bin/zsh";
  });

  afterEach(() => {
    if (origShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = origShell;
  });

  /** @scenario Instrumenting Grok writes its exports to the shell rc file once */
  it("writes one scoped grok function to the rc file however often it runs", () => {
    instrument();
    instrument();

    const rc = fs.readFileSync(rcFile(), "utf8");
    expect(rc.match(/^grok\(\)/gm)).toHaveLength(1);
    expect(rc).toContain("GROK_EXTERNAL_OTEL");
  });

  /** @scenario Instrumenting Grok also installs its hook file */
  it("writes LangWatch's Grok hook file", () => {
    const result = instrument();

    expect(result.warnings).toEqual([]);
    expect(JSON.parse(fs.readFileSync(hookFile(), "utf8"))).toMatchObject({
      hooks: { SessionStart: [{ hooks: [{ command: "langwatch ingest hook grok" }] }] },
    });
  });

  /** @scenario Logout removes Grok's exports and its hook file */
  it("leaves neither the exports nor the hook file after logout removes every target", () => {
    instrument();

    for (const target of scanTelemetryTargets({ cwd: temp.cwd }).filter((t) => t.present)) {
      target.remove();
    }

    expect(fs.readFileSync(rcFile(), "utf8")).not.toContain("GROK_EXTERNAL_OTEL");
    expect(fs.existsSync(hookFile())).toBe(false);
  });
});

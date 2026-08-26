import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("scenario child process remote-trace composition", () => {
  it("spreads the package-owned remote-trace configuration into the SDK run", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../scenario-child-process.ts"),
      "utf8",
    );

    expect(source.match(/judgeAgent\(\{/g)).toHaveLength(1);
    expect(source).toContain("ScenarioRunner.judgeAgent({");
    expect(source).toContain("...buildRemoteTraceRunConfig({");
    expect(source).toContain("traceWaitTimeoutMs: jobData.traceWaitTimeoutMs");
  });
});

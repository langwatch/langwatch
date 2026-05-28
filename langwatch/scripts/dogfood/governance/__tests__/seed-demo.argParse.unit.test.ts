import { describe, expect, it } from "vitest";
import { parseArgs } from "../seed-demo";

describe("seed-demo parseArgs", () => {
  it("returns dry-run defaults for no args", () => {
    expect(parseArgs([])).toEqual({
      execute: false,
      orgId: undefined,
      reportPath: undefined,
    });
  });

  it("flips execute on --execute", () => {
    expect(parseArgs(["--execute"]).execute).toBe(true);
  });

  it("captures --org-id value", () => {
    expect(parseArgs(["--org-id", "org_acme1234"]).orgId).toBe("org_acme1234");
  });

  it("captures --report-path value", () => {
    expect(parseArgs(["--report-path", "/tmp/run.txt"]).reportPath).toBe(
      "/tmp/run.txt",
    );
  });

  it("accepts all flags together in any order", () => {
    const parsed = parseArgs([
      "--report-path",
      "/tmp/x.txt",
      "--execute",
      "--org-id",
      "org_acme1234",
    ]);
    expect(parsed).toEqual({
      execute: true,
      orgId: "org_acme1234",
      reportPath: "/tmp/x.txt",
    });
  });

  it("throws when --org-id is missing its value", () => {
    expect(() => parseArgs(["--org-id"])).toThrow();
  });

  it("throws when --report-path is missing its value", () => {
    expect(() => parseArgs(["--report-path"])).toThrow();
  });

  it("throws on unknown arguments", () => {
    expect(() => parseArgs(["--whatever"])).toThrow();
  });
});

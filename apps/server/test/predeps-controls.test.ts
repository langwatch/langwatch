import { describe, expect, it } from "vitest";
import { makePostgresPredep } from "../src/predeps/postgres.ts";

const paths = {
  bin: "/tmp/langwatch-predep-controls/bin",
} as Parameters<ReturnType<typeof makePostgresPredep>["detect"]>[0];

describe("predep configuration controls", () => {
  it("injects the legacy bundled-Postgres decision before system detection", async () => {
    const predep = makePostgresPredep({ aiGatewayDevBuild: false, forceBundledPostgres: true });

    await expect(predep.detect(paths)).resolves.toMatchObject({
      installed: false,
      reason: expect.stringContaining("LANGWATCH_FORCE_BUNDLED_POSTGRES=1"),
    });
  });
});

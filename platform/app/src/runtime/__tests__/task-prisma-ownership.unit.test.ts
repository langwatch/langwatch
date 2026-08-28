import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function taskSource(): Promise<string> {
  return await readFile(fileURLToPath(new URL("../../task.ts", import.meta.url)), "utf8");
}

describe("standalone task Prisma ownership", () => {
  it("composes before loading tasks and passes the task connection to App composition", async () => {
    const source = await taskSource();
    const composeAt = source.indexOf("createProcessPrismaConnection({");
    const configureAt = source.indexOf("configure: configurePrismaConnection");
    const taskRegistryAt = source.indexOf('await import("./tasks.generated")');
    const taskLoadAt = source.indexOf("const script = await load()");

    expect(composeAt).toBeGreaterThan(-1);
    expect(configureAt).toBeGreaterThan(composeAt);
    expect(taskRegistryAt).toBeGreaterThan(configureAt);
    expect(taskLoadAt).toBeGreaterThan(taskRegistryAt);
    expect(source).toContain('"backfillAnnotationsToClickhouse"');
    expect(source).toContain('"backfillStalledSimulationRuns"');
    expect(source).toContain('"runTopicClustering"');
    expect(source).toContain("initializeDefaultApp({ prismaConnection: connection })");
    expect(source).toContain("closePrisma: closePrismaConnection");
  });
});

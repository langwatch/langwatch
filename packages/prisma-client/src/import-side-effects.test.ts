import { glob, readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const poolConstructor = vi.fn();
const adapterConstructor = vi.fn();
const clientConstructor = vi.fn();

vi.mock("pg", () => ({ Pool: poolConstructor }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: adapterConstructor }));
vi.mock("./generated/client", () => ({ PrismaClient: clientConstructor }));

describe("package import", () => {
  it("constructs no client, adapter, or pool and exports no ready-made client", async () => {
    const exports = await import("./index");

    expect(clientConstructor).not.toHaveBeenCalled();
    expect(adapterConstructor).not.toHaveBeenCalled();
    expect(poolConstructor).not.toHaveBeenCalled();
    expect(exports).not.toHaveProperty("prisma");
    expect(exports).not.toHaveProperty("client");
    expect(exports).not.toHaveProperty("pool");
  });

  it("contains no ambient environment reads outside generated code", async () => {
    const sources: string[] = [];
    for await (const path of glob("*.ts", { cwd: import.meta.dirname })) {
      if (path.endsWith(".test.ts")) continue;
      sources.push(await readFile(new URL(path, import.meta.url), "utf8"));
    }

    expect(sources.join("\n")).not.toMatch(/process\s*\.\s*env/);
  });
});

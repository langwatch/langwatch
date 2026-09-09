import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

function fixture(schema: string) {
  const root = mkdtempSync(join(tmpdir(), "prisma-catalogue-"));
  roots.push(root);
  for (const directory of ["prisma", "scripts", "src"]) mkdirSync(join(root, directory));
  const script = join(root, "scripts/generate-table-catalogue.mjs");
  const schemaFile = join(root, "prisma/schema.prisma");
  const output = join(root, "src/table-catalogue.ts");
  copyFileSync(new URL("../scripts/generate-table-catalogue.mjs", import.meta.url), script);
  writeFileSync(schemaFile, schema);
  return {
    run: (...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], { encoding: "utf8" }),
    output,
    schemaFile,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Prisma ownership catalogue generation", () => {
  it("preserves mapped physical identities with valid whitespace", () => {
    const world = fixture('model   User {\n id String @id\n @@map( "users" )\n}\n');
    expect(world.run().status).toBe(0);
    expect(readFileSync(world.output, "utf8")).toContain('"User": "users"');
    expect(world.run("--check").status).toBe(0);
  });

  it("rejects a stale physical mapping even when model names are unchanged", () => {
    const world = fixture('model User {\n id String @id\n @@map("users")\n}\n');
    expect(world.run().status).toBe(0);
    writeFileSync(world.schemaFile, 'model User {\n id String @id\n @@map("accounts")\n}\n');
    const checked = world.run("--check");
    expect(checked.status).not.toBe(0);
    expect(checked.stderr).toContain("Prisma table catalogue is stale");
  });

  it("captures optional relations and rejects stale relation metadata", () => {
    const world = fixture(
      "model User {\n id String @id\n profile Profile?\n}\nmodel Profile {\n id String @id\n}\n",
    );
    expect(world.run().status).toBe(0);
    expect(readFileSync(world.output, "utf8")).toContain('"profile": "Profile"');
    writeFileSync(world.schemaFile, "model User {\n id String @id\n}\nmodel Profile {\n id String @id\n}\n");
    expect(world.run("--check").status).not.toBe(0);
  });

  it.each(["", 'model User {\n id String @id\n @@schema("identity")\n}\n'])(
    "rejects unsupported schema %j",
    (schema) => {
      expect(fixture(schema).run().status).not.toBe(0);
    },
  );
});

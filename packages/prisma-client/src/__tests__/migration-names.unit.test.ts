import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { listPrismaMigrationNames } from "../migration.ts";

describe("listPrismaMigrationNames", () => {
  it("lists the release's migration folders in order, ignoring loose files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "prisma-migrations-"));
    await mkdir(path.join(root, "20240812215323_b"));
    await mkdir(path.join(root, "0_init"));
    await writeFile(path.join(root, "migration_lock.toml"), 'provider = "postgresql"');

    await expect(
      listPrismaMigrationNames({ migrationsPath: pathToFileURL(`${root}/`) }),
    ).resolves.toEqual(["0_init", "20240812215323_b"]);
  });

  it("answers nothing where the folder is not on this install", async () => {
    const missing = pathToFileURL(path.join(tmpdir(), "no-such-migrations-folder/"));

    await expect(listPrismaMigrationNames({ migrationsPath: missing })).resolves.toEqual([]);
  });

  it("finds the folder this package ships", async () => {
    const names = await listPrismaMigrationNames();

    expect(names[0]).toBe("0_init");
  });
});

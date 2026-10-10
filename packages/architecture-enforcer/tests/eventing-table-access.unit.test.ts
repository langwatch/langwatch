/** Spec: specs/eventing-table-access.feature. Record: dev/docs/ARCHITECTURE.md §7. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectEventingTableAccess,
  lintEventingTableAccess,
} from "../src/policies/persistence/eventing-table-access.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";
import { snapshotOf } from "./workspace.ts";

const CATALOGUE: FeatureCatalogueEntry[] = [
  { id: "ops", root: "modules/ops", classification: "core", subjects: ["ops"] },
];
const SCHEMA = `model ProcessManagerInstance {\n  id String @id\n}\n\nmodel ProcessManagerOutbox {\n  id String @id\n}\n\nmodel Project {\n  id String @id\n}\n`;
const FILE = "modules/ops/process/src/repositories/ops.repository.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), "eventing-tables-"));
  roots.push(root);
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  write("packages/prisma-client/prisma/schema.prisma", SCHEMA);
  write(FILE, source);

  return collectEventingTableAccess({ root, catalogue: CATALOGUE }).map((access) => [
    access.owner,
    access.kind,
    access.table,
  ]);
}

describe("eventing-table-access", () => {
  describe("given SQL over event tables in a module", () => {
    /** @scenario "SQL over an event table in module code is reported" */
    it("reports each table the SQL names", () => {
      expect(
        fixture(
          'export const read = `SELECT EventId FROM event_log WHERE TenantId = {t:String}`;\nexport const write = `UPDATE "ProcessManagerOutbox" SET "status" = $1`;\n',
        ),
      ).toEqual([
        ["ops", "sql", "event_log"],
        ["ops", "sql", "ProcessManagerOutbox"],
      ]);
    });
  });

  describe("given a Prisma delegate over a process-manager table", () => {
    /** @scenario "A Prisma delegate over a process-manager table is reported" */
    it("reports the delegate", () => {
      expect(
        fixture("export const find = (prisma: any) => prisma.processManagerInstance.findMany();\n"),
      ).toEqual([["ops", "delegate", "ProcessManagerInstance"]]);
    });
  });

  describe("given a module appending to the event store directly", () => {
    /** @scenario "Appending to the event store past the pipeline is reported" */
    it("reports both calls", () => {
      expect(
        fixture("export const append = (es: any) => es.getEventStore().storeEvents([]);\n"),
      ).toEqual([
        ["ops", "event-store", "storeEvents"],
        ["ops", "event-store", "getEventStore"],
      ]);
    });
  });

  describe("given a comment naming an event table", () => {
    /** @scenario "A comment naming an event table is not an access" */
    it("reports nothing", () => {
      expect(fixture("/** Folds without reading event_log. */\nexport const x = 1;\n")).toEqual([]);
    });
  });

  describe("given a snapshot of the fixture", () => {
    it("names the module and the table in the violation", () => {
      const root = mkdtempSync(join(tmpdir(), "eventing-tables-"));
      roots.push(root);
      mkdirSync(join(root, "packages/prisma-client/prisma"), { recursive: true });
      writeFileSync(join(root, "packages/prisma-client/prisma/schema.prisma"), SCHEMA);
      mkdirSync(dirname(join(root, FILE)), { recursive: true });
      writeFileSync(join(root, FILE), 'export const q = "SELECT 1 FROM event_log";\n');

      const [violation] = lintEventingTableAccess(snapshotOf({ root, catalogue: CATALOGUE }));
      expect(violation?.message).toBe(
        "ops runs SQL over event_log. Only packages/eventing touches the event tables.",
      );
    });
  });
});

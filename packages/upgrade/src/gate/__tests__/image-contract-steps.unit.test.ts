/**
 * A contract step is a schema step whose SQL carries the retirement note.
 * Spec: packages/upgrade/specs/contract-order.feature.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { imageContractSteps } from "../image-tree.ts";

describe("imageContractSteps()", () => {
  describe("given one dropping and one adding migration per engine", () => {
    /** @scenario "A schema step is a contract when its SQL carries the retirement note" */
    /** @scenario "A contract step's SQL names the background steps it runs after" */
    it("names only the dropping ones, each with the steps its after notes name", () => {
      const root = mkdtempSync(join(tmpdir(), "contract-steps-"));
      const directories = { prisma: join(root, "prisma"), goose: join(root, "goose") };
      const write = (path: string, sql: string) => {
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, sql);
      };
      try {
        write(
          join(directories.prisma, "20270101000000_drop_legacy_key", "migration.sql"),
          '-- contract: retired in 3.20.1\n-- after: identity:copy-legacy-key\nALTER TABLE "Project" DROP COLUMN "legacyKey";\n',
        );
        write(
          join(directories.prisma, "20270102000000_add_identifier", "migration.sql"),
          'ALTER TABLE "User" ADD COLUMN "identifier" TEXT;\n',
        );
        write(
          join(directories.goose, "00110_drop_old_spans.sql"),
          "-- +goose Up\n-- contract: retired in 3.20.1\nDROP TABLE IF EXISTS old_spans;\n",
        );
        write(
          join(directories.goose, "00111_add_index.sql"),
          "-- +goose Up\nALTER TABLE t ADD INDEX i (c) TYPE minmax;\n",
        );

        expect(imageContractSteps({ directories })).toEqual(
          new Map([
            ["prisma:20270101000000_drop_legacy_key", ["identity:copy-legacy-key"]],
            ["clickhouse:00110", []],
          ]),
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});

/** Spec: specs/module-ownership.feature. Record: dev/docs/ARCHITECTURE.md §17, rule 13a. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { FeatureCatalogueEntry } from "../../../types.ts";
import { forgetFileListings } from "../../../workspace/layout.ts";
import {
  collectPrismaModelAccess,
  lintPrismaModelOwnership,
  prismaModelOwners,
  prismaModelOwnershipFindings,
} from "../prisma-model-ownership.ts";

const SCHEMA =
  "model Widget {\n  id String @id\n}\n\nmodel Gadget {\n  id String @id\n}\n\nmodel WidgetPart {\n  id String @id\n}\n";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  forgetFileListings();
});

function fixture(modules: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), "prisma-model-ownership-"));
  roots.push(root);
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  write("packages/prisma-client/prisma/schema.prisma", SCHEMA);
  const catalogue = modules.map((id): FeatureCatalogueEntry => ({
    id,
    root: `modules/${id}`,
    classification: "core",
    subjects: [id],
  }));
  const findings = () =>
    prismaModelOwnershipFindings({ root, catalogue, shared: [] }).map((item) => ({
      file: relative(root, item.file),
      module: item.module,
      model: item.model,
      owner: item.owner,
      form: item.form,
    }));

  return { root, write, catalogue, findings };
}

const CLAIM = `import { PrismaRepository } from "@langwatch/prisma-client";\nexport class PrismaWidgetRepository extends PrismaRepository.for("Widget") {\n  find() { return this.prisma.widget.findMany({}); }\n}\n`;
const READER = "modules/b/process/src/repositories/prisma/prisma.b.repository.ts";

describe("prisma-model-ownership", () => {
  describe("given module a claims Widget", () => {
    describe("when module b calls the widget delegate on a Prisma client", () => {
      /** @scenario "A module reaching a peer's Prisma model is reported" */
      it("reports b's call naming Widget and its owner", () => {
        const workspace = fixture(["a", "b"]);
        workspace.write(
          "modules/a/process/src/repositories/prisma/prisma.widget.repository.ts",
          CLAIM,
        );
        workspace.write(
          READER,
          "export const read = (prisma: any) => prisma.widget.findMany({});\n",
        );

        expect(workspace.findings()).toEqual([
          { file: READER, module: "b", model: "Widget", owner: "a", form: "call" },
        ]);
      });
    });

    describe("when module b names the delegate through types", () => {
      /** @scenario "Every delegate spelling counts as a reach" */
      it("reports each spelling", () => {
        const workspace = fixture(["a", "b"]);
        workspace.write(
          "modules/a/process/src/repositories/prisma/prisma.widget.repository.ts",
          CLAIM,
        );
        workspace.write(
          READER,
          [
            'import type { PrismaClient } from "@langwatch/prisma-client/generated";',
            'type One = PrismaClient["widget"];',
            'type Two = Pick<PrismaClient, "widget" | "$transaction">;',
            "type Delegate<M, K> = unknown;",
            'type Three = { widget: Delegate<"widget", "findMany"> };',
          ].join("\n"),
        );

        expect(workspace.findings().map((item) => item.form)).toEqual([
          "client-index",
          "client-pick",
          "delegate-type",
        ]);
      });
    });

    describe("when only a reaches it", () => {
      /** @scenario "The owner reaching its own model is not reported" */
      it("reports nothing", () => {
        const workspace = fixture(["a", "b"]);
        workspace.write(
          "modules/a/process/src/repositories/prisma/prisma.widget.repository.ts",
          CLAIM,
        );

        expect(workspace.findings()).toEqual([]);
      });
    });

    describe("when b calls a port member named like the delegate", () => {
      /** @scenario "A port method named like a delegate call is not a reach" */
      it("reports nothing", () => {
        const workspace = fixture(["a", "b"]);
        workspace.write(
          "modules/a/process/src/repositories/prisma/prisma.widget.repository.ts",
          CLAIM,
        );
        workspace.write(
          "modules/b/process/src/services/b.service.ts",
          "export class B { run() { return this.repositories.widget.findMany(); } }\n",
        );

        expect(workspace.findings()).toEqual([]);
      });
    });

    describe("when b reaches it and the finding is linted", () => {
      /** @scenario "A prisma-model-ownership finding says what to do instead" */
      it("tells b to ask the owner through its Api or move the code", () => {
        const workspace = fixture(["a", "b"]);
        workspace.write(
          "modules/a/process/src/repositories/prisma/prisma.widget.repository.ts",
          CLAIM,
        );
        workspace.write(READER, "export const read = (tx: any) => tx.widget.count();\n");
        const [finding] = lintPrismaModelOwnership({
          root: workspace.root,
          catalogue: workspace.catalogue,
        });

        expect(finding?.message).toContain("b reaches Prisma model Widget, which a owns");
        expect(finding?.allowed).toContain("Ask the owning module through its *Api");
      });
    });
  });

  describe("given Gadget is claimed by no module and spells none", () => {
    describe("when a and b both reach it", () => {
      /** @scenario "A model whose owner cannot be derived is listed, not guessed" */
      it("lists it as undetermined and reports neither reach", () => {
        const workspace = fixture(["a", "b"]);
        workspace.write(
          "modules/a/process/src/a.ts",
          "export const a = (db: any) => db.gadget.count();\n",
        );
        workspace.write(
          "modules/b/process/src/b.ts",
          "export const b = (db: any) => db.gadget.count();\n",
        );
        const accesses = collectPrismaModelAccess({
          root: workspace.root,
          catalogue: workspace.catalogue,
        });

        expect(
          prismaModelOwners({ root: workspace.root, catalogue: workspace.catalogue, accesses })
            .undetermined,
        ).toEqual(new Map([["Gadget", ["a", "b"]]]));
        expect(workspace.findings()).toEqual([]);
      });
    });
  });

  describe("given WidgetPart is claimed by no module and spells module widget", () => {
    describe("when widget and b both reach it", () => {
      /** @scenario "A model's owner is derived from its name when the named module reaches it" */
      it("reports b's reach with widget as the owner", () => {
        const workspace = fixture(["widget", "b"]);
        workspace.write(
          "modules/widget/process/src/w.ts",
          "export const w = (db: any) => db.widgetPart.count();\n",
        );
        workspace.write(READER, "export const b = (db: any) => db.widgetPart.count();\n");

        expect(workspace.findings()).toEqual([
          { file: READER, module: "b", model: "WidgetPart", owner: "widget", form: "call" },
        ]);
      });
    });
  });
});

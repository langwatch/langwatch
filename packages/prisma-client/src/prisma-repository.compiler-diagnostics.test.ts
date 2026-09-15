import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repository = resolve(root, "src/prisma-repository.ts");
const generatedClient = resolve(root, "src/generated/client.ts");
const tsc = resolve(root, "node_modules/.bin/tsc");

function diagnosticsFor(source: string): readonly string[] {
  const directory = mkdtempSync(join(tmpdir(), "prisma-repository-types-"));
  const file = join(directory, "fixture.ts");
  const config = join(directory, "tsconfig.json");
  writeFileSync(
    file,
    source.replaceAll("__REPOSITORY__", repository).replaceAll("__GENERATED_CLIENT__", generatedClient),
  );
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
      },
      files: [file],
    }),
  );

  try {
    execFileSync(tsc, ["--project", config, "--pretty", "false"], { encoding: "utf8" });
    return [];
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string };
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const errors = output
      .split("\n")
      .filter((line) => line.includes("error TS"));
    const fixtureErrors = errors.filter((line) => line.includes("fixture.ts("));
    const externalErrors = errors.filter((line) => !line.includes("fixture.ts("));
    if (externalErrors.length > 0 || fixtureErrors.length === 0) {
      throw new Error(`Fixture compiler failed outside the expected source: ${output}`, {
        cause: error,
      });
    }
    return fixtureErrors;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("PrismaRepository compiler diagnostics", () => {
  it("preserves native delegate inference through a declared base class", () => {
    expect(
      diagnosticsFor(`
        import { PrismaRepository } from "__REPOSITORY__";
        class AnnotationRepository extends PrismaRepository.for("Annotation") {
          static readonly create = this.factory((prisma) => new AnnotationRepository(prisma));
          async read() {
            const row = await this.prisma.annotation.findUnique({
              where: { id: "annotation-1" },
              select: { id: true },
            });
            row?.id.toUpperCase();
          }
        }
        void AnnotationRepository;
      `),
    ).toEqual([]);
  });

  it("keeps foreign delegates inaccessible", () => {
    const diagnostics = diagnosticsFor(`
      import { PrismaRepository } from "__REPOSITORY__";
      class AnnotationRepository extends PrismaRepository.for("Annotation") {
        static readonly create = this.factory((prisma) => new AnnotationRepository(prisma));
        read() {
          return this.prisma.user.findUnique({ where: { id: "user-1" } }); // EXPECT_FOREIGN
        }
      }
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("TS2339");
  });

  it("preserves native selected-row inference", () => {
    const diagnostics = diagnosticsFor(`
      import { PrismaRepository } from "__REPOSITORY__";
      class AnnotationRepository extends PrismaRepository.for("Annotation") {
        static readonly create = this.factory((prisma) => new AnnotationRepository(prisma));
        async read() {
          const row = await this.prisma.annotation.findUnique({
            where: { id: "annotation-1" },
            select: { id: true },
          });
          return row?.name; // EXPECT
        }
      }
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("TS2339");
  });

  it("restricts interactive transaction callbacks to the declared delegates", () => {
    const diagnostics = diagnosticsFor(`
      import { PrismaRepository } from "__REPOSITORY__";
      class QueueRepository extends PrismaRepository.transactionalFor("AnnotationQueue") {
        static readonly create = this.factory((prisma) => new QueueRepository(prisma));
        async read() {
          return this.transaction(async (transaction) => {
            await transaction.annotationQueue.findUnique({ where: { id: "queue-1" } });
            return transaction.user.findUnique({ where: { id: "user-1" } }); // EXPECT
          });
        }
      }
      void QueueRepository;
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("TS2339");
  });

  it("provides a repository bundle compatible with defineRepositories", () => {
    expect(
      diagnosticsFor(`
        import { PrismaRepository, prismaRepositories } from "__REPOSITORY__";
        class AnnotationRepository extends PrismaRepository.for("Annotation") {
          static readonly create = this.factory((prisma) => new AnnotationRepository(prisma));
        }
        class QueueRepository extends PrismaRepository.transactionalFor("AnnotationQueue") {
          static readonly create = this.factory((prisma) => new QueueRepository(prisma));
        }
        const repositories = prismaRepositories({ annotations: AnnotationRepository, queues: QueueRepository });
        void repositories;
      `),
    ).toEqual([]);
  });
});

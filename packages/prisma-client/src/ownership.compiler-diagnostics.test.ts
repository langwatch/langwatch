import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ownership = resolve(root, "src/ownership.ts");
const generatedClient = resolve(root, "src/generated/client.ts");
const tsc = resolve(root, "node_modules/.bin/tsc");

type Diagnostic = Readonly<{ line: number; code: string }>;

function diagnosticsFor(source: string): Diagnostic[] {
  const directory = mkdtempSync(join(tmpdir(), "prisma-model-client-types-"));
  const file = join(directory, "fixture.ts");
  const config = join(directory, "tsconfig.json");
  writeFileSync(
    file,
    source
      .replaceAll("__OWNERSHIP__", ownership)
      .replaceAll("__GENERATED_CLIENT__", generatedClient),
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
    execFileSync(tsc, ["--project", config, "--pretty", "false"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return [];
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string };
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const diagnostics = output.split("\n").flatMap((outputLine) => {
      const match = outputLine.match(/fixture\.ts\((\d+),\d+\): error (TS\d+):/);
      const [, lineNumber, code] = match ?? [];
      return lineNumber !== undefined && code !== undefined
        ? [{ line: Number(lineNumber), code }]
        : [];
    });
    const hasExternalError = output.split("\n").some((line) => {
      return line.includes("error TS") && !line.includes("fixture.ts(");
    });
    if (diagnostics.length === 0 || hasExternalError) {
      throw new Error(`Fixture compiler failed outside the expected source: ${output}`, {
        cause: error,
      });
    }
    return diagnostics;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("Prisma model client compiler diagnostics", () => {
  it("preserves native delegate select and include inference", () => {
    expect(
      diagnosticsFor(`
        import type { PrismaModelClient } from "__OWNERSHIP__";
        import type { PrismaClient } from "__GENERATED_CLIENT__";
        declare const fullClient: PrismaClient;
        const queueClient: PrismaModelClient<"AnnotationQueue"> = fullClient;
        async function readQueue() {
          const selected = await queueClient.annotationQueue.findUnique({
            where: { id: "queue-1" },
            select: { id: true, name: true },
          });
          selected?.name.toUpperCase();
          const included = await queueClient.annotationQueue.findUnique({
            where: { id: "queue-1" },
            include: { project: true },
          });
          included?.project.name.toUpperCase();
        }
        void readQueue;
      `),
    ).toEqual([]);
  });

  const cases = [
    [
      "hides fields omitted by a select",
      "TS2339",
      `
        import type { PrismaModelClient } from "__OWNERSHIP__";
        declare const queueClient: PrismaModelClient<"AnnotationQueue">;
        async function readQueue() {
          const selected = await queueClient.annotationQueue.findUnique({ where: { id: "queue-1" }, select: { id: true } });
          selected?.name; // EXPECT
        }
        void readQueue;
      `,
    ],
    [
      "hides foreign model delegates",
      "TS2339",
      `
        import type { PrismaModelClient } from "__OWNERSHIP__";
        declare const queueClient: PrismaModelClient<"AnnotationQueue">;
        queueClient.user.findUnique({ where: { id: "user-1" } }); // EXPECT
      `,
    ],
    [
      "rejects an unknown Prisma model",
      "TS2344",
      `
        import type { PrismaModelClient } from "__OWNERSHIP__";
        type InvalidClient = PrismaModelClient<"NotAModel">; // EXPECT
        declare const invalid: InvalidClient;
        void invalid;
      `,
    ],
  ] as const;

  it.each(cases)("%s", (_name, code, source) => {
    const expectedLine = source.split("\n").findIndex((line) => line.includes("// EXPECT")) + 1;
    expect(diagnosticsFor(source)).toEqual([{ line: expectedLine, code }]);
  });
});

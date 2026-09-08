import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/** @scenario "A REST endpoint is one complete declaration in the server" */
it("accepts the fluent annotation REST router and rejects a body from an implicit no-content route", () => {
  const directory = mkdtempSync(join(process.cwd(), ".tmp-rest-transport-"));
  const accepted = join(directory, "accepted.ts");
  const rejected = join(directory, "rejected.ts");
  const mismatchedParams = join(directory, "mismatched-params.ts");
  const unpermitted = join(directory, "unpermitted.ts");
  const transport = join(process.cwd(), "src/rest/rest-router.ts");

  writeFileSync(
    accepted,
    `import { z } from "zod";
import { defineRestRouter } from ${JSON.stringify(transport)};
import { featureApi } from "@langwatch/runtime-composition/contract";

interface AnnotationApi {
  getAnnotation(input: { id: string }): Promise<{ id: string }>;
  updateAnnotation(input: { id: string; title: string }): Promise<{ id: string }>;
  deleteAnnotation(input: { id: string }): Promise<void>;
}

const AnnotationApi = featureApi<AnnotationApi>("annotation");
const transportDeclaration = defineRestRouter(AnnotationApi)
  .withNamespace("annotations")
  .withVersion("2026-08-07")
  .get("/:id", "getAnnotation")
  .withParams(z.object({ id: z.string() }))
  .withPermission("annotations:view")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.getAnnotation({ id: input.id }))
  .patch("/:id", "updateAnnotation")
  .withParams(z.object({ id: z.string() }))
  .withInput(z.object({ title: z.string() }))
  .withPermission("annotations:update")
  .withOutput(z.object({ id: z.string() }))
  .handle(({ app, input }) => app.updateAnnotation(input))
  .delete("/:id", "deleteAnnotation")
  .withParams(z.object({ id: z.string() }))
  .withPermission("annotations:update")
  .handle(({ app, input }) => app.deleteAnnotation(input))
  .build();
transportDeclaration.router();
`,
  );

  writeFileSync(
    rejected,
    `import { defineRestRouter } from ${JSON.stringify(transport)};
import { featureApi } from "@langwatch/runtime-composition/contract";

const AnnotationApi = featureApi<object>("annotation");
defineRestRouter(AnnotationApi).withNamespace("annotations").withVersion("2026-08-07")
  .get("/", "deleteAnnotation").withPermission("annotations:update").handle(() => ({ body: "forbidden" }));
`,
  );

  writeFileSync(
    mismatchedParams,
    `import { z } from "zod";
import { defineRestRouter } from ${JSON.stringify(transport)};
import { featureApi } from "@langwatch/runtime-composition/contract";

const AnnotationApi = featureApi<object>("annotation");
const annotationRestParamsSchema = z.object({ id: z.string() });
defineRestRouter(AnnotationApi).withNamespace("annotations").withVersion("2026-08-07")
  .get("/:idd", "getAnnotation")
  .withParams(annotationRestParamsSchema)
  .withPermission("annotations:view")
  .handle(() => {});
`,
  );

  writeFileSync(
    unpermitted,
    `import { defineRestRouter } from ${JSON.stringify(transport)};
import { featureApi } from "@langwatch/runtime-composition/contract";

const AnnotationApi = featureApi<object>("annotation");
defineRestRouter(AnnotationApi).withNamespace("annotations").withVersion("2026-08-07")
  .get("/", "listAnnotations").handle(() => {});
`,
  );

  try {
    expect(compile(accepted)).toBe("");
    expect(compile(rejected)).toMatch(/not assignable to type 'void \| Promise<void>'/);
    expect(compile(mismatchedParams)).toMatch(/not assignable to parameter of type 'never'/);
    expect(compile(unpermitted)).toMatch(/'this' context of type/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function compile(fixture: string): string {
  try {
    execFileSync(
      "pnpm",
      [
        "exec",
        "tsc",
        "--noEmit",
        "--pretty",
        "false",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ESNext",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--types",
        "node",
        "--allowImportingTsExtensions",
        "--ignoreConfig",
        fixture,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

    return "";
  } catch (error) {
    const processError = error as { stdout?: string; stderr?: string };

    return `${processError.stdout ?? ""}${processError.stderr ?? ""}`;
  }
}

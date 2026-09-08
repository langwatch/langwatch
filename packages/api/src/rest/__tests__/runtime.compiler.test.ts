/**
 * What the compiler refuses in a REST declaration. Each refusal is written
 * WITHOUT a suppression, so the assertion is the diagnostic itself.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */
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
  const transport = join(process.cwd(), "src/rest/runtime.ts");

  writeFileSync(
    accepted,
    `import { z } from "zod";
import { defineRestRouter } from ${JSON.stringify(transport)};
import { featureApi } from "@langwatch/runtime-composition";

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
import { featureApi } from "@langwatch/runtime-composition";

const AnnotationApi = featureApi<object>("annotation");
defineRestRouter(AnnotationApi).withNamespace("annotations").withVersion("2026-08-07")
  .get("/", "deleteAnnotation").withPermission("annotations:update").handle(() => ({ body: "forbidden" }));
`,
  );

  writeFileSync(
    mismatchedParams,
    `import { z } from "zod";
import { defineRestRouter } from ${JSON.stringify(transport)};
import { featureApi } from "@langwatch/runtime-composition";

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
import { featureApi } from "@langwatch/runtime-composition";

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

it("infers trailing middleware arguments and rejects wrong facts and responses", () => {
  const directory = mkdtempSync(join(process.cwd(), ".tmp-transport-middleware-"));
  const fixture = join(directory, "fixture.ts");

  writeFileSync(
    fixture,
    `import { z } from "zod";
import { featureApi } from "@langwatch/runtime-composition";
import { defineRestRouter } from "../src/rest/runtime.ts";
import { defineRestMiddleware } from "../src/rest/request.ts";
const api = featureApi<object>("annotation");
const facts = defineRestMiddleware("caller", z.object({ userId: z.string() }));
const route = () => defineRestRouter(api).withNamespace("annotations").withVersion("2026-09-08")
  .get("/", "read").withPermission("annotations:view")
  .withOutput(z.object({ id: z.string() })).withMiddleware(facts);
route().handle((_args, caller) => ({ id: caller.userId }));
route().handle((_args, caller) => ({ id: caller.token }));
route().handle(() => ({ id: 42 }));
route().handle(() => new Response());
const payload = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("count"), count: z.number() }),
]);
const unionRoute = () => defineRestRouter(api).withNamespace("annotations").withVersion("2026-09-08")
  .post("/:id", "write").withParams(z.object({ id: z.string() }))
  .withInput(payload).withPermission("annotations:view").withOutput(z.object({ id: z.string() }));
unionRoute().handle(({ input }) => ({ id: input.kind === "text" ? input.text : String(input.count) }));
unionRoute().handle(({ input }) => ({ id: input.text }));
const conflict = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), id: z.string() }),
  z.object({ kind: z.literal("count"), count: z.number() }),
]);
defineRestRouter(api).withNamespace("annotations").withVersion("2026-09-08")
  .post("/:id", "conflict").withParams(z.object({ id: z.string() })).withInput(conflict);
`,
  );

  try {
    const errors = compile(fixture)
      .split("\n")
      .filter((line) => line.includes("fixture.ts(") && line.includes("error TS"));

    expect(errors).toHaveLength(5);
    expect(errors[0]).toContain("Property 'token' does not exist");
    expect(errors[1]).toContain("number");
    expect(errors[2]).toContain("Response");
    expect(errors[3]).toContain("Property 'text' does not exist");
    expect(errors[4]).toContain("never");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** @scenario "A handler on an organization door receives the organization scope" */
it("types the handler's scope from the declared credential, and refuses a door with none", () => {
  const directory = mkdtempSync(join(process.cwd(), ".tmp-transport-credential-"));
  const fixture = join(directory, "fixture.ts");

  writeFileSync(
    fixture,
    `import { z } from "zod";
import { featureApi } from "@langwatch/runtime-composition";
import { defineRestRouter } from "../src/rest/runtime.ts";
const api = featureApi<object>("role");
const tier = z.object({ tier: z.literal("organization") });
defineRestRouter(api).withNamespace("roles").withVersion("2026-09-08")
  .withCredential("organizationKey")
  .get("/", "listRoles").withPermission("organization:manage").withOutput(tier)
  .handle(({ scope }) => ({ tier: scope.tier }));
defineRestRouter(api).withNamespace("secrets").withVersion("2026-09-08")
  .get("/", "listSecrets").withPermission("secrets:view").withOutput(tier)
  .handle(({ scope }) => ({ tier: scope.tier }));
defineRestRouter(api).withNamespace("admin").withVersion("2026-09-08")
  .withCredential("session");
`,
  );

  try {
    const errors = compile(fixture)
      .split("\n")
      .filter((line) => line.includes("fixture.ts(") && line.includes("error TS"));

    expect(errors).toHaveLength(2);
    // The project door's own scope: `"project"` where the route promised
    // `"organization"`, which is the credential typing the handler.
    expect(errors[0]).toContain('"project"');
    expect(errors[0]).toContain('"organization"');
    expect(errors[1]).toContain('"session"');
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

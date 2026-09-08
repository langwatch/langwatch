import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("infers trailing middleware arguments and rejects wrong facts and responses", () => {
  const directory = mkdtempSync(join(process.cwd(), ".tmp-transport-middleware-"));
  const fixture = join(directory, "fixture.ts");

  writeFileSync(
    fixture,
    `import { z } from "zod";
import { featureApi } from "@langwatch/runtime-composition/contract";
import { defineRestRouter } from "../src/rest/rest-router.ts";
import { defineRestMiddleware } from "../src/rest/transport-middleware.ts";
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
    let diagnostics = "";

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
          "--allowImportingTsExtensions",
          "--ignoreConfig",
          fixture,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      diagnostics = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
    }

    const errors = diagnostics
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

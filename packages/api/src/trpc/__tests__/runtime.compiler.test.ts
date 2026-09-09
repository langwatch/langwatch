/**
 * What the compiler refuses when a server binds handlers to a contract. Each
 * refusal is written WITHOUT a suppression, so the assertion is the diagnostic
 * itself. Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fixture = (contract: string, router: string, body: string) => `import { z } from "zod";
import { defineTrpcContract } from ${JSON.stringify(contract)};
import { defineTrpcRouter } from ${JSON.stringify(router)};
import { moduleApi } from "@langwatch/runtime-composition";

interface AnnotationApi { read(input: { id: string }): Promise<{ id: string }> }
const AnnotationApi = moduleApi<AnnotationApi>("annotation");
const scope = z.object({ projectId: z.string(), id: z.string() });
const contract = defineTrpcContract("annotation")
  .query("getById").withInput(scope).withOutput(z.object({ id: z.string() }))
  .mutation("deleteById").withInput(scope)
  .build();
const implemented = () => defineTrpcRouter(AnnotationApi, contract)
  .procedure("getById").withPermission("annotations:view").handle(async () => ({ id: "" }));
${body}
`;

describe("binding a server to a contract", () => {
  /** @scenario "A server implementation may only name procedures the contract declared" */
  /** @scenario "A procedure cannot be implemented twice or left unimplemented" */
  /** @scenario "A procedure without an access decision has no handler to call" */
  /** @scenario "The server repeats nothing the contract said" */
  it("refuses an unknown name, a repeat, an omission, a missing decision and a wrong answer", () => {
    const directory = mkdtempSync(join(process.cwd(), ".tmp-trpc-router-"));
    const contract = join(process.cwd(), "src/contract/index.ts");
    const router = join(process.cwd(), "src/trpc/runtime.ts");
    const path = join(directory, "refusals.ts");

    writeFileSync(
      path,
      fixture(
        contract,
        router,
        `defineTrpcRouter(AnnotationApi, contract).procedure("archive");
implemented().procedure("getById");
implemented().build();
defineTrpcRouter(AnnotationApi, contract).procedure("getById").handle(async () => ({ id: "" }));
defineTrpcRouter(AnnotationApi, contract)
  .procedure("deleteById").withPermission("annotations:delete").handle(async () => ({ id: "" }));
defineTrpcRouter(AnnotationApi, contract)
  .procedure("getById").withPermission("annotations:view").handle(async () => ({ wrong: "" }));`,
      ),
    );

    try {
      const diagnostics = compile(path);
      expect(diagnostics).toMatch(/refusals\.ts\(15,\d+\).*not assignable to parameter of type/);
      expect(diagnostics).toMatch(/refusals\.ts\(16,\d+\).*not assignable to parameter of type/);
      expect(diagnostics).toMatch(/refusals\.ts\(17,\d+\).*procedureNotImplemented/);
      expect(diagnostics).toMatch(/refusals\.ts\(18,\d+\).*Property 'handle' does not exist/);
      expect(diagnostics).toMatch(/refusals\.ts\(20,\d+\).*not assignable to type 'void/);
      expect(diagnostics).toMatch(/refusals\.ts\(22,\d+\).*not assignable to type 'ValueResult/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function compile(path: string): string {
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
        path,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return "";
  } catch (error) {
    const processError = error as { stdout?: string; stderr?: string };
    return `${processError.stdout ?? ""}${processError.stderr ?? ""}`;
  }
}

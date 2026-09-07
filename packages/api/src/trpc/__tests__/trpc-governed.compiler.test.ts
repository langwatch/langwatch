import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("rejects raw context access in governed feature handlers", () => {
  const directory = mkdtempSync(join(process.cwd(), ".tmp-trpc-governed-"));
  const fixture = join(directory, "fixture.ts");
  const source = join(process.cwd(), "src/trpc/trpc-service-builder.ts");

  writeFileSync(
    fixture,
    `import { z } from "zod";
import type { TrpcDeclaredAbsent, TrpcProcedureChain } from ${JSON.stringify(source)};

const input = z.object({ id: z.string() });
const output = z.object({ id: z.string() });
declare const chain: TrpcProcedureChain<object, "query", typeof input, typeof output, true, { app: true }, { id: string }, { id: string }>;
chain.handle(({ ctx }) => ({ id: ctx }));
declare const noInput: TrpcProcedureChain<object, "query", TrpcDeclaredAbsent, typeof output, true, { app: true }, never, never>;
noInput.handle(({ input }) => ({ id: String(input) }));
chain.handle(() => ({ id: 7 }));
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
      const processError = error as { stdout?: string; stderr?: string };
      diagnostics = `${processError.stdout ?? ""}${processError.stderr ?? ""}`;
    }

    expect(diagnostics).toMatch(/Property 'ctx' does not exist/);
    expect(diagnostics).toMatch(/not assignable to method's 'this' of type 'never'/);
    expect(diagnostics).toMatch(/Type 'number' is not assignable to type 'string'/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("rejects validateOutput on a governed API mount", () => {
  const directory = mkdtempSync(join(process.cwd(), ".tmp-trpc-api-mount-"));
  const fixture = join(directory, "fixture.ts");
  const service = join(process.cwd(), "src/trpc/trpc-api-service.ts");
  const root = join(process.cwd(), "src/trpc/trpc-root.ts");
  const handler = join(process.cwd(), "src/trpc/trpc-handler.ts");

  writeFileSync(
    fixture,
    `import { createTrpcApiService } from ${JSON.stringify(service)};
import { TrpcRootDefinition } from ${JSON.stringify(root)};
import type { AppTrpcPolicyMiddlewares } from ${JSON.stringify(service)};
import { createTrpcHandlerBinding } from ${JSON.stringify(handler)};

type Context = { actor: { id: string } };
type App = { projects: string };
const root = TrpcRootDefinition.forContext<Context>().create({});
declare const middlewares: AppTrpcPolicyMiddlewares;
const handlerBinding = createTrpcHandlerBinding<Context, App>(async () => ({
  app: { projects: "projects" }, actor: null, scope: null,
}));
createTrpcApiService({
  root,
  protectedProcedure: root.procedure,
  middlewares,
  handlerBinding,
  validateOutput: false,
});
createTrpcApiService({
  root,
  protectedProcedure: root.procedure,
  middlewares,
  handlerBinding,
  validateOutput: true,
});
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
      const processError = error as { stdout?: string; stderr?: string };
      diagnostics = `${processError.stdout ?? ""}${processError.stderr ?? ""}`;
    }

    const refusedCalls = [
      ...diagnostics.matchAll(
        /fixture\.ts\((\d+),\d+\): error TS2769: No overload matches this call/g,
      ),
    ];
    expect(refusedCalls).toHaveLength(2);
    expect(new Set(refusedCalls.map((match) => match[1])).size).toBe(2);
    expect(diagnostics).toMatch(/handlerBinding/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

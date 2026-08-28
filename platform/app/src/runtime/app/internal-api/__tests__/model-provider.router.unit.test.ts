/** @vitest-environment node */

/**
 * The process mount for the Model Provider vertical.
 *
 * Two things this proves that the package's own suite cannot:
 *
 * 1. The mount loads. `protectedProcedure` used to be a custom builder that
 *    only exposed `.mutation`/`.query` after a permission `.use()`, so a
 *    procedure declared without one threw at module load and crashed the API
 *    process. Importing the module here reproduces that boot.
 * 2. Every procedure carries an authz declaration the router sweep can read,
 *    and every declaration sits AFTER the input parser. A check appended
 *    before `.input()` receives `input === undefined`, so a declaration that
 *    resolves a scope id from the input would pass on nothing at all — the
 *    one mistake the package/process split makes possible.
 */
import { type AuthzDeclaration, authzDeclarationOf } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import { llmModelCostsRouter, modelProviderRouter } from "../model-provider.router";

type BuiltProcedure = {
  _def: { middlewares?: unknown[]; inputs?: unknown[] };
};

function proceduresOf(router: unknown): Record<string, BuiltProcedure> {
  return (router as { _def: { procedures: Record<string, BuiltProcedure> } })._def.procedures;
}

/** The declaration the router sweep would read off one built procedure. */
function declarationOf(procedure: BuiltProcedure): AuthzDeclaration | null {
  return (
    (procedure._def.middlewares ?? [])
      .map((middleware) => authzDeclarationOf(middleware))
      .find((found) => found !== null) ?? null
  );
}

describe("the Model Provider process mount", () => {
  describe("given the composed routers", () => {
    it("loads without throwing and exposes the write path", () => {
      expect(proceduresOf(modelProviderRouter).update).toBeDefined();
      expect(proceduresOf(llmModelCostsRouter).createOrUpdate).toBeDefined();
    });

    it("declares an access decision for every procedure", () => {
      const undeclared = [
        ...Object.entries(proceduresOf(modelProviderRouter)).map(
          ([path, procedure]) => [`modelProvider.${path}`, declarationOf(procedure)] as const,
        ),
        ...Object.entries(proceduresOf(llmModelCostsRouter)).map(
          ([path, procedure]) => [`llmModelCost.${path}`, declarationOf(procedure)] as const,
        ),
      ]
        .filter(([, declaration]) => declaration === null)
        .map(([path]) => path);

      expect(undeclared).toEqual([]);
    });

    it("parses the input before any declared check runs", () => {
      const offenders: string[] = [];
      for (const [name, router] of [
        ["modelProvider", modelProviderRouter],
        ["llmModelCost", llmModelCostsRouter],
      ] as const) {
        for (const [path, procedure] of Object.entries(proceduresOf(router))) {
          const middlewares = procedure._def.middlewares ?? [];
          const checkIndex = middlewares.findIndex(
            (middleware) => authzDeclarationOf(middleware) !== null,
          );
          // tRPC appends its parser as a middleware at the point `.input()`
          // is called, and there is exactly one on every procedure here. The
          // parser must therefore sit ahead of the declared check.
          const parserIndex = middlewares.findIndex(
            (middleware) =>
              typeof middleware === "function" &&
              (middleware as { _type?: string })._type === "input",
          );
          if (parserIndex === -1 || checkIndex === -1 || parserIndex > checkIndex) {
            offenders.push(`${name}.${path}`);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  });
});

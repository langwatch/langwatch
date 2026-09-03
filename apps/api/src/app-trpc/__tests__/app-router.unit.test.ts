/**
 * `AppRouter` carries the procedures, not an erased record.
 *
 * A browser package builds ONE client from this type. If the feature record
 * reaches it as `TRPCRouterRecord` — which is what the `as unknown as` cast in
 * `api-trpc-features.composition.ts` used to guarantee — every call still
 * compiles, every input is `unknown`, and every answer is untyped: the client
 * would be no better than the hand-written api maps it replaces, and nothing
 * would say so. So the assertions below name real procedures across several
 * features and demand a real input and a real answer for each.
 *
 * These assertions are TYPE-LEVEL. Neither this package's vitest config nor
 * `apps/ui`'s enables `typecheck`, so a `vitest run` executes them as no-ops:
 * they fail `pnpm typecheck`, not the test run.
 */
import type { inferProcedureInput, inferProcedureOutput } from "@trpc/server";
import { describe, expectTypeOf, it } from "vitest";
import type { AppRouter } from "../app-trpc.types";

describe("given a browser package builds its client from AppRouter", () => {
  describe("when it reads the application's own two routers", () => {
    it("infers the agent and secret answers", () => {
      expectTypeOf<inferProcedureOutput<AppRouter["agents"]["getAll"]>>().not.toBeAny();
      expectTypeOf<inferProcedureOutput<AppRouter["secrets"]["list"]>>().not.toBeAny();
    });
  });

  describe("when it reads a packaged namespace", () => {
    it("infers the account answers the /me screens render", () => {
      expectTypeOf<inferProcedureOutput<AppRouter["user"]["getAccountInfo"]>>().not.toBeAny();
      expectTypeOf<inferProcedureOutput<AppRouter["user"]["hasPassword"]>>().not.toBeAny();
    });

    it("infers the support inbox reads", () => {
      expectTypeOf<inferProcedureOutput<AppRouter["bugReports"]["getAll"]>>().not.toBeAny();
      expectTypeOf<inferProcedureInput<AppRouter["bugReports"]["getById"]>>().not.toBeAny();
    });

    it("infers the privacy settings read and its two writes", () => {
      expectTypeOf<inferProcedureOutput<AppRouter["dataPrivacy"]["getSnapshot"]>>().not.toBeAny();
      expectTypeOf<inferProcedureInput<AppRouter["dataPrivacy"]["setForScope"]>>().not.toBeAny();
    });

    it("infers an api key mint", () => {
      expectTypeOf<inferProcedureInput<AppRouter["apiKey"]["create"]>>().not.toBeAny();
      expectTypeOf<inferProcedureOutput<AppRouter["apiKey"]["list"]>>().not.toBeAny();
    });
  });

  describe("when it reads a namespace two owners merged onto one wire name", () => {
    it("infers the Enterprise /me dashboard reads mounted onto user.*", () => {
      expectTypeOf<inferProcedureOutput<AppRouter["user"]["personalUsage"]>>().not.toBeAny();
      expectTypeOf<inferProcedureOutput<AppRouter["user"]["budgetOverview"]>>().not.toBeAny();
    });

    it("infers the charted reads and the workbench under analytics.*", () => {
      expectTypeOf<inferProcedureInput<AppRouter["analytics"]["getTimeseries"]>>().not.toBeAny();
      expectTypeOf<inferProcedureOutput<AppRouter["analytics"]["lwql"]["query"]>>().not.toBeAny();
    });
  });

  describe("when it subscribes rather than calls", () => {
    it("infers what a live view is handed", () => {
      expectTypeOf<inferProcedureInput<AppRouter["export"]["onExportProgress"]>>().not.toBeAny();
      expectTypeOf<inferProcedureInput<AppRouter["presence"]["onPresenceUpdate"]>>().not.toBeAny();
    });
  });
});

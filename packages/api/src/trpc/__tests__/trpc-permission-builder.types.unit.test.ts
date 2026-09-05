/**
 * The compile-time half of the declaring builder: after `.input()` a pending builder offers only the declaring methods, and
 * its `.use()` escape hatch accepts only a branded declared check. Mirrors `packages/api/type-tests/trpc-public-api.ts`,
 * wrapped as a runtime-visible scenario so the sweep no longer needs to walk a live router to prove it.
 */
import type { DeclaredAuthzMiddleware } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import type {
  PendingPermissionProcedureBuilder,
  TrpcCheckMiddleware,
} from "../trpc-permission-builder.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

type Pending = PendingPermissionProcedureBuilder<
  { actor: { id: string } },
  { actor: { id: string } },
  object,
  object,
  { projectId: string },
  { projectId: string },
  unknown,
  unknown,
  false
>;

describe("PendingPermissionProcedureBuilder", () => {
  describe("given a procedure that has declared its input", () => {
    /** @scenario "A service endpoint that declares no access fails to compile" */
    /** @scenario "Every tRPC procedure declares its access decision or an explicit reason not to" */
    it("offers only the declaring methods — no .query, .mutation or .subscription", () => {
      type _DeclarationIsMandatoryByConstruction = Assert<
        Equal<
          keyof Pending,
          "input" | "use" | "permission" | "permissionAny" | "noPermission" | "authorizeInService"
        >
      >;
      expect(true satisfies _DeclarationIsMandatoryByConstruction).toBe(true);
    });
  });

  describe("given the custom-check escape hatch", () => {
    /** @scenario "A hand-rolled procedure middleware cannot claim a permission check" */
    it("accepts only middleware carrying the declaration brand, not a bare function", () => {
      type UseParam = Parameters<Pending["use"]>[0];
      type BareMiddleware = TrpcCheckMiddleware<{ actor: { id: string } }, { projectId: string }>;

      type _BrandRequired = Assert<Equal<UseParam, DeclaredAuthzMiddleware<BareMiddleware>>>;
      type _BareMiddlewareRefused = Assert<BareMiddleware extends UseParam ? false : true>;
      expect(true satisfies _BrandRequired).toBe(true);
      expect(true satisfies _BareMiddlewareRefused).toBe(true);
    });
  });
});

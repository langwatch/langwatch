import type { TrpcProcedureFactory, TrpcProcedureRequest } from "@langwatch/api/trpc";
import type { RoleApi } from "@langwatch/role-contract";
/**
 * @vitest-environment node
 * `role.getAll` answers the custom roles only: the Roles tab and the grant
 * dialog draw the built-ins themselves. specs/rbac/grants-rest-api.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { roleTrpcTransport } from "../role.trpc.ts";

/** Mounts the declaration on a recording runtime and keeps each procedure's request. */
function mountedProcedures(app: RoleApi): Map<string, TrpcProcedureRequest<object>> {
  const procedures = new Map<string, TrpcProcedureRequest<object>>();
  const runtime: TrpcProcedureFactory<object> = {
    procedure: (request) => {
      procedures.set(request.procedure.slice(request.procedure.indexOf(".") + 1), request);

      return {};
    },
    router: (record) => record,
  };
  roleTrpcTransport.router(runtime, () => app);

  return procedures;
}

describe("the role.getAll procedure", () => {
  describe("when the Roles tab reads an organization's roles", () => {
    it("asks the application for the custom roles only", async () => {
      const listRoles = vi.fn<RoleApi["listRoles"]>(async () => []);
      const getAll = mountedProcedures(createApiFixture<RoleApi>({ listRoles }, "RoleApi")).get(
        "getAll",
      );
      if (!getAll) throw new Error("role.getAll was not declared");

      // `handle` is typed `never` on the inert request; Reflect.apply calls it as the runtime does.
      await Reflect.apply(getAll.handle, undefined, [
        { app: getAll.app({}), input: { organizationId: "org-1" } },
      ]);

      expect(listRoles).toHaveBeenCalledExactlyOnceWith({
        organizationId: "org-1",
        builtIn: false,
      });
    });
  });
});

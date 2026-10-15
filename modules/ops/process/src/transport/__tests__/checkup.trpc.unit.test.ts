/**
 * @vitest-environment node
 * The checkup's install-wide write: an organization manager is refused ops:manage at the door.
 * Spec: modules/ops/specs/checkup-audience.feature
 */
import {
  bindTrpcMiddlewareContext,
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcProcedureFactory,
  type TrpcRouterMount,
} from "@langwatch/api/trpc";
import type { OpsApi, OpsOperator } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { checkupTrpcTransport } from "../checkup.trpc.ts";
import { opsOperatorContext } from "../ops-operator.trpc.ts";
import { opsTrpcMembers, type OpsTrpcTestContext } from "./ops.trpc.harness.ts";

const OPERATOR: OpsOperator = { id: "user_alex", email: "alex@langwatch.test" };
const MANAGER: OpsOperator = { id: "user_kim", email: "kim@acme.test" };

/** Every procedure the declaration binds, with the access it asked of the door. */
function boundAccess(): Record<string, string> {
  const declared: Record<string, string> = {};
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access }) => {
      declared[procedure] =
        access.kind === "permission-platform" ? `${access.kind}:${access.permission}` : access.kind;
      return {};
    },
    router: (record) => record,
  };
  (checkupTrpcTransport as { router: TrpcRouterMount<never, never> }).router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });
  return declared;
}

function mount() {
  const setUsageReportSwitches = vi.fn<OpsApi["setUsageReportSwitches"]>(async () => ({
    deployment: "saas",
  }));
  const app = createApiFixture<OpsApi>({ setUsageReportSwitches });
  const root = TrpcRootDefinition.forContext<OpsTrpcTestContext>().create();
  const router = createTrpcRuntime<OpsTrpcTestContext>({
    root,
    procedure: root.procedure,
    members: opsTrpcMembers({ holders: { [OPERATOR.id]: ["ops:manage"] } }),
  }).mount(checkupTrpcTransport, () => app, {
    middlewareContext: [
      bindTrpcMiddlewareContext(opsOperatorContext, (ctx: OpsTrpcTestContext) => ctx.operator),
    ],
  });
  const callerFor = (operator: OpsOperator) =>
    router.createCaller({ actor: { id: operator.id }, operator });

  return { setUsageReportSwitches, operator: callerFor(OPERATOR), manager: callerFor(MANAGER) };
}

describe("the checkup's usage report switches", () => {
  it("asks ops:manage at the platform tier, while the reads and the paid run keep organization grants", () => {
    expect(boundAccess()).toMatchObject({
      "checkup.setUsageReportSwitches": "permission-platform:ops:manage",
    });
    expect(boundAccess()["checkup.run"]).not.toMatch(/^permission-platform/);
  });

  describe("given an organization manager who holds no platform grant", () => {
    it("is refused at the door and nothing is written", async () => {
      const { manager, setUsageReportSwitches } = mount();

      await expect(
        manager.setUsageReportSwitches({ organizationId: "org-1", hostnameOptOut: true }),
      ).rejects.toBeDefined();
      expect(setUsageReportSwitches).not.toHaveBeenCalled();
    });
  });

  describe("given a platform operator", () => {
    it("reaches the application with the operator named", async () => {
      const { operator, setUsageReportSwitches } = mount();

      await operator.setUsageReportSwitches({ organizationId: "org-1", hostnameOptOut: true });

      expect(setUsageReportSwitches).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          hostnameOptOut: true,
          operator: OPERATOR,
        }),
      );
    });
  });
});

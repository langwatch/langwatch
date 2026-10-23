/**
 * @vitest-environment node
 * @see modules/trace/specs/braided-spans.feature
 * The braid dialog's reads through the real tRPC runtime (ADR-185 §7): read access asked at both
 * projects and the Enterprise plan at the door, each project's proof handed to the app by field.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { AuthzDeclaredScopeId, AuthzPermission } from "@langwatch/authorization";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { testAuthorizeDefaults, trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { BraidPreview, TraceApi } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { tracesTrpcTransport } from "../traces.trpc.ts";

type Context = { actor: { id: string } | null };

const OWNER = "project_specialists";
const READER = "project_orchestrator";

const counted = { every: 1, some: 0, none: 0, total: 1, capped: false };
const previewed: BraidPreview = {
  refusal: null,
  traces: counted,
  spans: 2,
  live: { braids: 0, traces: { ...counted, every: 0, none: 1 }, spans: 0 },
  unsignedHidden: null,
  example: null,
};

type Holds = (input: { permission: AuthzPermission; scope: AuthzDeclaredScopeId }) => boolean;

function mount({ holds = () => true, enterprise = true }: { holds?: Holds; enterprise?: boolean }) {
  const app = {
    previewBraid: vi.fn<TraceApi["previewBraid"]>(async () => previewed),
    readBraidTestTrace: vi.fn<TraceApi["readBraidTestTrace"]>(async () => ({
      found: false,
      nodes: [],
    })),
  };
  const trpc = initTRPC.context<Context>().create();
  const members = trpcTestMembers<Context>({
    overrides: {
      authorization: {
        forRequest: () => ({
          ...testAuthorizeDefaults,
          getDecision: async ({ permission, scope }) => ({
            permitted: holds({ permission, scope }),
            organizationRole: null,
          }),
          getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
          checkScopeLineage: async () => ({ kind: "consistent" }),
        }),
      },
      entitlements: { holds: async () => enterprise },
    },
  });
  const runtime = createTrpcRuntime<Context>({ root: trpc, procedure: trpc.procedure, members });
  const router = trpc.router({
    traces: runtime.mount(tracesTrpcTransport, () => createApiFixture<TraceApi>(app)),
  });
  return { app, caller: router.createCaller({ actor: { id: "user_ana" } }).traces };
}

const readsOnly =
  (projectId: string): Holds =>
  ({ permission, scope }) =>
    permission === "traces:view" && scope.tier === "project" && scope.id === projectId;

const draft = { projectId: OWNER, readerProjectId: READER, where: "", fromMs: 0 };
const denied = { code: "FORBIDDEN" };

describe("the braid dialog's trace reads", () => {
  describe("given an admin who can read the traces of both projects", () => {
    it("hands the app the owner's proof and the reader's, each by its field", async () => {
      const { caller, app } = mount({});

      await expect(caller.braidPreview(draft)).resolves.toEqual(previewed);

      const call = app.previewBraid.mock.calls[0]?.[0];
      expect(call?.ownerAuthorization).toBeDefined();
      expect(call?.readerAuthorization).toBeDefined();
      expect(call?.ownerAuthorization).not.toBe(call?.readerAuthorization);
    });

    it("hands the app the braid being edited, which the draft replaces in both reads", async () => {
      const { caller, app } = mount({});

      await caller.braidPreview({ ...draft, braidId: "braid_web" });
      await caller.braidTestTrace({ ...draft, traceId: "trace-1", braidId: "braid_web" });

      expect(app.previewBraid.mock.calls[0]?.[0]).toMatchObject({ braidId: "braid_web" });
      expect(app.readBraidTestTrace.mock.calls[0]?.[0]).toMatchObject({ braidId: "braid_web" });
    });
  });

  describe("given an admin who can read only one of the two projects' traces", () => {
    /** @scenario "The preview asks for read access on both projects at the door" */
    it("refuses the preview and the test trace either way round before the app is reached", async () => {
      for (const readable of [OWNER, READER]) {
        const { caller, app } = mount({ holds: readsOnly(readable) });

        await expect(caller.braidPreview(draft)).rejects.toMatchObject(denied);
        await expect(caller.braidTestTrace({ ...draft, traceId: "trace-1" })).rejects.toMatchObject(
          denied,
        );
        expect(app.previewBraid).not.toHaveBeenCalled();
        expect(app.readBraidTestTrace).not.toHaveBeenCalled();
      }
    });
  });

  describe("given an organisation below Enterprise", () => {
    /** @scenario "The preview needs the Enterprise plan" */
    it("refuses the preview and the test trace naming the Braids feature", async () => {
      const { caller, app } = mount({ enterprise: false });
      const refused = { cause: { code: "enterprise_plan_required", meta: { feature: "BRAIDS" } } };

      await expect(caller.braidPreview(draft)).rejects.toMatchObject(refused);
      await expect(caller.braidTestTrace({ ...draft, traceId: "trace-1" })).rejects.toMatchObject(
        refused,
      );
      expect(app.previewBraid).not.toHaveBeenCalled();
    });
  });
});

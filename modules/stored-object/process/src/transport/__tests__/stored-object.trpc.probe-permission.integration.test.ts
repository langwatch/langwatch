import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * Who may probe a stored object, through the mounted procedure: any file-view
 * permission admits the call, then the object's own purpose decides.
 * @see specs/traces-v2/media-rendering.feature
 */
import type {
  AuthzDenialReason,
  AuthzPermission,
  PermissionDecision,
} from "@langwatch/authz-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import {
  GrantedStoredObjectPermissions,
  createStoredObjectTestApp,
} from "../../app/__tests__/stored-object.fixture.ts";
import type {
  StoredObjectFileReader,
  StoredObjectFileStreamRead,
  StoredObjectProbe,
} from "../../app/stored-object.members.ts";
import { storedObjectTrpcTransport } from "../stored-object.trpc.ts";

const PROJECT = "project_1";

type TestContext = { actor: { id: string } };

/** The legacy index, answering one row per id with the purpose it was kept for. */
class PurposeFiles implements StoredObjectFileReader {
  readonly rows = new Map<string, StoredObjectProbe>();

  keep(input: { id: string; purpose: string }): string {
    this.rows.set(input.id, { status: "missing", mediaType: "image/png", purpose: input.purpose });
    return input.id;
  }

  async headById(input: { id: string }): Promise<StoredObjectProbe> {
    return this.rows.get(input.id) ?? { status: "not_found" };
  }

  async tryGetById(): Promise<StoredObjectFileStreamRead | null> {
    return null;
  }
}

/** A viewer whose only grant is `granted`, answered the same way by both steps. */
function viewer(
  granted: readonly AuthzPermission[],
  denialReason: AuthzDenialReason = "no-binding",
) {
  const files = new PurposeFiles();
  const permissions = new GrantedStoredObjectPermissions(granted, denialReason);
  const app = createStoredObjectTestApp({ members: { files }, permissions });
  const trpc = initTRPC.context<TestContext>().create();

  const anyOf = async (input: {
    permissions: readonly AuthzPermission[];
  }): Promise<PermissionDecision> =>
    input.permissions.some((permission) => granted.includes(permission))
      ? { permitted: true, organizationRole: "MEMBER" }
      : { permitted: false, organizationRole: "MEMBER", denialReason: "no-binding" };

  const members: TrpcRuntimeMembers<TestContext> = {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: (input) => permissions.getDecision(input),
        getProjectAnyDecision: anyOf,
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };

  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members,
  }).mount(storedObjectTrpcTransport, () => app);

  return { files, caller: router.createCaller({ actor: { id: "viewer-1" } }) };
}

function refusalNaming(permission: AuthzPermission) {
  return { cause: { code: "permission_denied", meta: { permission } } };
}

describe("storedObjects.headById: who may probe", () => {
  describe.each(["traces:view", "scenarios:view", "datasets:view"] as const)(
    "given a viewer whose only grant is %s",
    (permission) => {
      /** @scenario "A viewer with trace access can probe trace media" */
      it("reaches the service and answers the probe", async () => {
        const { caller } = viewer([permission]);

        await expect(caller.headById({ projectId: PROJECT, id: "absent" })).resolves.toEqual({
          status: "not_found",
        });
      });
    },
  );

  describe("given a viewer holding none of the media permissions", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("refuses the probe, naming the permission to ask for", async () => {
      const { caller } = viewer(["prompts:view"]);

      await expect(caller.headById({ projectId: PROJECT, id: "absent" })).rejects.toMatchObject(
        refusalNaming("traces:view"),
      );
    });
  });

  describe("given a viewer holding only dataset access", () => {
    describe("when the viewer probes trace media", () => {
      /** @scenario "A probe is refused when the object's own permission is missing" */
      it("refuses the probe, naming the permission the object asks for", async () => {
        const { caller, files } = viewer(["datasets:view"]);
        const id = files.keep({ id: "trace-media", purpose: "trace_content" });

        await expect(caller.headById({ projectId: PROJECT, id })).rejects.toMatchObject(
          refusalNaming("traces:view"),
        );
      });
    });

    describe("when the viewer probes scenario media", () => {
      /** @scenario "A probe is refused when the object's own permission is missing" */
      it("refuses that probe too", async () => {
        const { caller, files } = viewer(["datasets:view"]);
        const id = files.keep({ id: "scenario-media", purpose: "scenario_attachment" });

        await expect(caller.headById({ projectId: PROJECT, id })).rejects.toMatchObject(
          refusalNaming("scenarios:view"),
        );
      });
    });

    describe("when the viewer probes a dataset attachment", () => {
      /** @scenario "A probe is refused when the object's own permission is missing" */
      it("answers the probe without the purpose", async () => {
        const { caller, files } = viewer(["datasets:view"]);
        const id = files.keep({ id: "attachment", purpose: "dataset_attachment" });

        await expect(caller.headById({ projectId: PROJECT, id })).resolves.toEqual({
          status: "missing",
          mediaType: "image/png",
        });
      });
    });

    describe("when the engine refuses a lite member the object's own permission", () => {
      /** @scenario "A probe is refused when the object's own permission is missing" */
      it("reports the engine's reason rather than a missing binding", async () => {
        const { caller, files } = viewer(["datasets:view"], "lite-member-restricted");
        const id = files.keep({ id: "trace-media", purpose: "trace_content" });

        await expect(caller.headById({ projectId: PROJECT, id })).rejects.toMatchObject({
          cause: {
            code: "permission_denied",
            meta: { permission: "traces:view", denialReason: "lite-member-restricted" },
          },
        });
      });
    });
  });
});

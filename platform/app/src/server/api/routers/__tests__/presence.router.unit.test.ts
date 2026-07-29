import { EventEmitter } from "node:events";
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import { PresenceService } from "~/server/app-layer/presence/presence.service";
import { InMemoryPresenceRepository } from "~/server/app-layer/presence/repositories/presence.memory.repository";
import type { PresenceEvent } from "~/server/app-layer/presence/types";
import { createInnerTRPCContext } from "../../trpc";
import { presenceRouter } from "../presence";

// ---------------------------------------------------------------------------
// This suite runs the REAL rbac middleware and the REAL PresenceService: the
// only simulated boundaries are prisma (an in-memory tenancy fixture filtered
// the same way the real where-clauses select) and the broadcast fan-out.
// ---------------------------------------------------------------------------

vi.mock("~/server/db", () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));

const { presenceState } = vi.hoisted(() => ({
  presenceState: { app: null as any },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => presenceState.app,
}));

// ---------------------------------------------------------------------------
// Tenancy fixture: org_a owns project_a (team_a). Alice and Bob are members
// with traces:view through a project-scoped binding; Mallory is in no org.
// ---------------------------------------------------------------------------

const projects: Record<string, { teamId: string; organizationId: string }> = {
  project_a: { teamId: "team_a", organizationId: "org_a" },
};

const organizationUsers = [
  { userId: "user_alice", organizationId: "org_a", role: "MEMBER" },
  { userId: "user_bob", organizationId: "org_a", role: "MEMBER" },
];

const roleBindings = [
  {
    userId: "user_alice",
    organizationId: "org_a",
    scopeType: "PROJECT",
    scopeId: "project_a",
    role: "ADMIN",
    customRoleId: null,
  },
  {
    userId: "user_bob",
    organizationId: "org_a",
    scopeType: "PROJECT",
    scopeId: "project_a",
    role: "ADMIN",
    customRoleId: null,
  },
];

function fixturePrisma(): PrismaClient {
  return {
    project: {
      findUnique: vi.fn(({ where }: any) => {
        const project = projects[where.id];
        if (!project) return Promise.resolve(null);
        return Promise.resolve({
          id: where.id,
          team: { id: project.teamId, organizationId: project.organizationId },
        });
      }),
    },
    organizationUser: {
      findFirst: vi.fn(({ where }: any) =>
        Promise.resolve(
          organizationUsers.find(
            (m) =>
              m.userId === where.userId &&
              m.organizationId === where.organizationId,
          ) ?? null,
        ),
      ),
    },
    groupMembership: { findMany: vi.fn(() => Promise.resolve([])) },
    roleBinding: {
      findMany: vi.fn(({ where }: any) =>
        Promise.resolve(
          roleBindings.filter(
            (b) =>
              b.organizationId === where.organizationId &&
              where.scopeId.in.includes(b.scopeId) &&
              where.OR.some(
                (clause: any) =>
                  clause.userId === b.userId &&
                  organizationUsers.some(
                    (m) =>
                      m.userId === b.userId &&
                      m.organizationId === where.organizationId,
                  ),
              ),
          ),
        ),
      ),
    },
    teamUser: { findFirst: vi.fn(() => Promise.resolve(null)) },
  } as unknown as PrismaClient;
}

let repository: InMemoryPresenceRepository;
let broadcasts: PresenceEvent[];

function buildApp() {
  broadcasts = [];
  repository = new InMemoryPresenceRepository();

  const broadcast = {
    broadcastToTenant: async (_tenantId: string, event: string) => {
      broadcasts.push(JSON.parse(event) as PresenceEvent);
    },
    broadcastToTenantRateLimited: async () => {},
    getTenantEmitter: () => new EventEmitter(),
    cleanupTenantEmitter: () => {},
  } as unknown as BroadcastService;

  return {
    presence: new PresenceService(repository, broadcast, {
      getPresenceConfig: async () => ({
        orgEnabled: true,
        projectEnabled: true,
      }),
    }),
    broadcast,
  };
}

function callerForUser(userId: string) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: userId, name: "Some One" }, expires: "1" } as any,
    req: undefined,
    res: undefined,
  });
  ctx.prisma = fixturePrisma();
  return presenceRouter.createCaller(ctx);
}

const LOCATION = {
  lens: "traces" as const,
  route: { traceId: "trace_1" },
  view: { panel: "flame" as const },
};

describe("presence router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    presenceState.app = buildApp();
  });

  describe("given a user with no membership of the project's organization", () => {
    describe("when they try to subscribe to the project's presence", () => {
      /** @scenario A user without traces:view permission for the project cannot subscribe */
      it("rejects the subscription with an authorization error", async () => {
        const caller = callerForUser("user_mallory");

        await expect(
          caller.onPresenceUpdate({ projectId: "project_a" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });

      it("also refuses their presence updates and cursor ticks", async () => {
        const caller = callerForUser("user_mallory");

        await expect(
          caller.update({
            projectId: "project_a",
            sessionId: "mallory_tab_1",
            location: LOCATION,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        await expect(
          caller.cursor({
            projectId: "project_a",
            sessionId: "mallory_tab_1",
            payload: { anchor: "trace:trace_1", x: 0.5, y: 0.5 },
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        expect(await repository.findByProjectId("project_a")).toEqual([]);
      });
    });
  });

  describe("given two members of the same project already present", () => {
    describe("when another member opens a subscription", () => {
      /** @scenario Subscribers receive a snapshot of currently active sessions on connect */
      it("receives a snapshot naming both of them as its first frame", async () => {
        const alice = callerForUser("user_alice");
        const bob = callerForUser("user_bob");
        await alice.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          location: LOCATION,
        });
        await bob.update({
          projectId: "project_a",
          sessionId: "bob_tab_1",
          location: { lens: "traces", route: {} },
        });

        const stream = (await alice.onPresenceUpdate({
          projectId: "project_a",
        })) as AsyncGenerator<PresenceEvent>;

        try {
          const first = await stream.next();
          expect(first.done).toBe(false);
          const event = first.value;
          expect(event.kind).toBe("snapshot");
          if (event.kind !== "snapshot") throw new Error("expected snapshot");
          expect(event.sessions.map((s) => s.user.id).sort()).toEqual([
            "user_alice",
            "user_bob",
          ]);
        } finally {
          await stream.return(undefined as never);
        }
      });
    });
  });

  describe("given a member sending a presence update", () => {
    describe("when the payload claims another member's userId", () => {
      /** @scenario A user cannot impersonate another user's presence session */
      it("records the session under the authenticated user, not the claimed one", async () => {
        const bob = callerForUser("user_bob");

        await bob.update({
          projectId: "project_a",
          sessionId: "bob_tab_1",
          location: LOCATION,
          user: { id: "user_alice", name: "Alice", image: null },
        } as any);

        const sessions = await repository.findByProjectId("project_a");
        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.user.id).toBe("user_bob");

        const joins = broadcasts.filter((event) => event.kind === "join");
        expect(joins).toHaveLength(1);
        expect(joins[0]).toMatchObject({
          kind: "join",
          session: { user: { id: "user_bob" } },
        });
        expect(JSON.stringify(sessions)).not.toContain("user_alice");
      });
    });

    describe("when the payload carries an extra pointer field alongside the location", () => {
      /** @scenario The recorded location carries only lens, route, and view */
      it("records only lens, route and view, discarding the rest", async () => {
        const alice = callerForUser("user_alice");

        await alice.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          location: {
            ...LOCATION,
            cursor: { x: 120, y: 480 },
            selection: "some highlighted text",
          },
        } as any);

        const [session] = await repository.findByProjectId("project_a");
        expect(Object.keys(session?.location ?? {}).sort()).toEqual([
          "lens",
          "route",
          "view",
        ]);
        expect(JSON.stringify(session?.location)).not.toContain("cursor");
        expect(JSON.stringify(session?.location)).not.toContain("selection");
      });
    });

    describe("when a pointer coordinate is smuggled inside route or view", () => {
      /** @scenario A pointer coordinate smuggled inside route or view is rejected */
      it("rejects the update as invalid input and stores nothing", async () => {
        const alice = callerForUser("user_alice");

        await expect(
          alice.update({
            projectId: "project_a",
            sessionId: "alice_tab_1",
            location: {
              lens: "traces",
              route: { traceId: "trace_1", pointerX: 0.5 },
            },
          } as any),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });

        await expect(
          alice.update({
            projectId: "project_a",
            sessionId: "alice_tab_1",
            location: {
              lens: "traces",
              route: {},
              view: { panel: "flame", pointerY: 0.5 },
            },
          } as any),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });

        expect(await repository.findByProjectId("project_a")).toEqual([]);
      });
    });
  });
});

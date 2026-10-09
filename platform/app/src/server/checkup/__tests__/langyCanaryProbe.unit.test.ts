/**
 * The checkup's Langy canary decides with the Langy panel's own gate.
 *
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { Session } from "~/server/auth";
import { probeLangyCanary } from "../langyCanaryProbe";

const SESSION: Session = {
  user: {
    id: "user_admin",
    name: "Admin",
    email: "admin@acme.com",
    image: null,
  },
  expires: "2026-09-27T00:00:00.000Z",
};

/** Flags as an install with `langyagent.enableForAllUsers` has them. */
function flagsOpen(open: Set<string>) {
  return { isEnabled: vi.fn(async (flag: string) => open.has(flag)) };
}

function input(overrides: Partial<Parameters<typeof probeLangyCanary>[0]>) {
  return {
    actorUserId: "user_admin",
    organizationId: "org_1",
    project: async () => ({ id: "project_1" }),
    resolveActor: async () => SESSION,
    run: vi.fn(async () => ({ healthy: true as const, durationMs: 1200 })),
    ...overrides,
  };
}

describe("probeLangyCanary", () => {
  describe("given Langy is open to everyone and the Langy API key surface is off", () => {
    describe("when the administrator runs the canary", () => {
      /** @scenario "The Langy canary asks the same access question the Langy panel asks" */
      it("sends one turn as that administrator and answers healthy", async () => {
        const flags = flagsOpen(new Set(["release_langy_enabled"]));
        const run = vi.fn(async () => ({
          healthy: true as const,
          durationMs: 1200,
        }));

        const probe = await probeLangyCanary(input({ flags, run }));

        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith({
          projectId: "project_1",
          session: SESSION,
        });
        expect(probe).toMatchObject({
          kind: "answered",
          answer: { status: 200 },
        });
        expect(flags.isEnabled).toHaveBeenCalledWith(
          "release_langy_enabled",
          expect.objectContaining({
            distinctId: "user_admin",
            projectId: "project_1",
            organizationId: "org_1",
          }),
        );
      });
    });
  });

  describe("given Langy is not open to the administrator", () => {
    describe("when the canary runs", () => {
      /** @scenario "The Langy canary is not checked for someone Langy is not open to" */
      it("sends no turn and answers no access", async () => {
        const run = vi.fn();

        const probe = await probeLangyCanary(
          input({ flags: flagsOpen(new Set()), run }),
        );

        expect(probe).toEqual({ kind: "no_access" });
        expect(run).not.toHaveBeenCalled();
      });
    });
  });

  describe("given Langy is open only to the administrator's email domain", () => {
    describe("when the canary runs", () => {
      /** @scenario "The Langy canary honours an email-domain rollout rule" */
      it("asks the gate with the administrator's email and sends the turn", async () => {
        const flags = {
          isEnabled: vi.fn(
            async (_flag: string, ctx: { userEmail?: string | null }) =>
              ctx.userEmail?.endsWith("@acme.com") === true,
          ),
        };
        const run = vi.fn(async () => ({
          healthy: true as const,
          durationMs: 1200,
        }));

        const probe = await probeLangyCanary(input({ flags, run }));

        expect(run).toHaveBeenCalledTimes(1);
        expect(probe).toMatchObject({ kind: "answered" });
      });
    });
  });

  describe("given no person asked for the checkup", () => {
    describe("when the canary runs", () => {
      it("sends no turn and answers no actor", async () => {
        const run = vi.fn();

        const probe = await probeLangyCanary(input({ actorUserId: null, run }));

        expect(probe).toEqual({ kind: "no_actor" });
        expect(run).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the turn fails", () => {
    describe("when the canary runs", () => {
      it("answers 503 with the reason", async () => {
        const probe = await probeLangyCanary(
          input({
            flags: flagsOpen(new Set(["release_langy_enabled"])),
            run: vi.fn(async () => ({
              healthy: false as const,
              reason: "turn_failed" as const,
              durationMs: 900,
            })),
          }),
        );

        expect(probe).toEqual({
          kind: "answered",
          answer: { status: 503, body: { message: "turn_failed" } },
        });
      });
    });
  });
});

/**
 * The organization's second-factor requirement is asked at the door, after the permit, once per
 * request and scope; the declared recovery read is the only no-permission procedure it skips.
 * @see specs/identity/mfa-and-session-shape.feature
 */

import type { PermissionDecision } from "@langwatch/authorization";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApiDouble } from "../../__tests__/api-double.ts";
import type { Authorize } from "../../access/access.ts";
import { SessionReader } from "../../hosting/session-reader.ts";
import { composeTrpcRouters } from "../compose.ts";
import { TrpcHost } from "../host.ts";
import { defineTrpcRouter } from "../runtime.ts";

interface KeyApi {
  read(input: { projectId: string }): { ok: boolean };
  create(input: { organizationId: string }): { ok: boolean };
  standing(input: { organizationId: string }): { ok: boolean };
}

const KeyApi = moduleApi<KeyApi>()("api-key");

const procedures = defineTrpcRouter(
  KeyApi,
  defineTrpcContract("keys")
    .query("read")
    .withInput(z.object({ projectId: z.string() }))
    .withOutput(z.object({ ok: z.boolean() }))
    .mutation("create")
    .withInput(z.object({ organizationId: z.string() }))
    .withOutput(z.object({ ok: z.boolean() }))
    .query("standing")
    .withInput(z.object({ organizationId: z.string() }))
    .withOutput(z.object({ ok: z.boolean() }))
    .build(),
)
  .procedure("read")
  .withPermission("annotations:view")
  .handle(({ app, input }) => app.read(input))
  .procedure("create")
  .noPermission({
    reason: "a test stand-in for a key minted for the caller's own organization",
    allow: { organizationId: "the organization the key is minted for" },
  })
  .handle(({ app, input }) => app.create(input))
  .procedure("standing")
  .noPermission({
    reason: "a test stand-in for the standing read",
    allow: { organizationId: "the organization the caller is trying to reach" },
    mfaRecovery: { reason: "the held member reads what they must do to recover" },
  })
  .handle(({ app, input }) => app.standing(input))
  .build();

function served({ held, permitted = true }: { held: boolean; permitted?: boolean }) {
  const authz = createApiDouble<Authorize>({
    getDecision: async (): Promise<PermissionDecision> => ({
      permitted,
      organizationRole: "MEMBER",
    }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
    organizationOf: async () => "acme",
    assertSecondFactor: async () => {
      if (held) throw new Error("held at the second-factor gate");
    },
  });
  const gate = vi.spyOn(authz, "assertSecondFactor");
  const minted: string[] = [];
  const application: KeyApi = {
    read: () => ({ ok: true }),
    create: ({ organizationId }) => {
      minted.push(organizationId);
      return { ok: true };
    },
    standing: () => ({ ok: true }),
  };
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({
      verify: async () => ({ userId: "sam", sessionId: "session-1" }),
    }),
    authz,
  });
  trpc.mount(composeTrpcRouters("keys", [procedures]), () => application);

  const call = async (path: string, init?: RequestInit) => {
    const response = await fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: new Request(`http://api.test${TrpcHost.path}/${path}`, init),
      router: trpc.router,
      createContext: ({ req }) => trpc.context({ request: req }),
    });

    return (await response.json()) as unknown;
  };

  return { call, gate, minted };
}

const input = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe("given a person in a browser session reaching an organization's data", () => {
  describe("when a batch asks two procedures on the same project", () => {
    it("asks the organization's requirement once, with the session the person holds", async () => {
      const { call, gate } = served({ held: false });

      await call(
        `keys.read,keys.read?batch=1&input=${input({ 0: { projectId: "p1" }, 1: { projectId: "p1" } })}`,
      );

      expect(gate).toHaveBeenCalledTimes(1);
      expect(gate).toHaveBeenCalledWith({
        userId: "sam",
        sessionId: "session-1",
        organizationId: "acme",
        scope: { tier: "project", id: "p1" },
      });
    });
  });

  describe("when the permission itself is refused", () => {
    it("refuses for the permission and never asks the requirement", async () => {
      const { call, gate } = served({ held: true, permitted: false });

      const answer = (await call(`keys.read?input=${input({ projectId: "p1" })}`)) as {
        error?: unknown;
      };

      expect(answer.error).toBeDefined();
      expect(gate).not.toHaveBeenCalled();
    });
  });
});

describe("given a member held until two-step verification is enrolled", () => {
  /** @scenario "A held member cannot carry the standing recovery exemption into API-key creation" */
  it("answers the recovery read and refuses key creation before the handler runs", async () => {
    const { call, gate, minted } = served({ held: true });

    const standing = (await call(`keys.standing?input=${input({ organizationId: "acme" })}`)) as {
      result?: unknown;
    };
    const created = (await call("keys.create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: "acme" }),
    })) as { error?: unknown };

    expect(standing.result).toBeDefined();
    expect(created.error).toBeDefined();
    expect(minted).toEqual([]);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { tier: "organization", id: "acme" } }),
    );
  });
});

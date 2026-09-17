/**
 * The six session-bearing facts this process answers, and what each answers
 * with no session behind the request. Mounted on a PUBLIC family: some sit
 * on routes whose door resolves nobody, so they read the session themselves.
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestMiddleware, defineRestRouter } from "@langwatch/api/rest";
import { moduleApi, type TransportPeers } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiRestHost, type ApiRestBrowserCaller } from "../api-rest.host.ts";

interface ProbeApi {
  read(): string;
}
const ProbeApi = moduleApi<ProbeApi>()("dataset");

/** The declaring modules' own facts, restated by NAME as a family would. */
const adminActor = defineRestMiddleware(
  "adminActor",
  z
    .object({
      id: z.string(),
      email: z.string().nullish(),
      impersonator: z
        .object({ id: z.string().optional(), email: z.string().nullish() })
        .nullish(),
    })
    .nullable(),
);
const adminAuthSession = defineRestMiddleware(
  "adminAuthSession",
  z.object({ id: z.string() }).nullable(),
);
const mcpAuthorizeApprover = defineRestMiddleware(
  "mcpAuthorizeApprover",
  z.object({ user: z.object({ id: z.string() }) }).nullable(),
);
const userAvatarCaller = defineRestMiddleware(
  "userAvatarCaller",
  z.object({ apiKeyProjectId: z.string().nullable(), userId: z.string().nullable() }),
);
const playgroundRestCaller = defineRestMiddleware(
  "playgroundRestCaller",
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("anonymous") }),
    z.object({ kind: z.literal("signedIn"), userId: z.string(), permitted: z.boolean() }),
  ]),
);
const playgroundRestExecutionProxy = defineRestMiddleware(
  "playgroundRestExecutionProxy",
  z.string(),
);

const WHOEVER_IS_THERE = publicRoute({
  reason: "the route reads the session itself and publishes its own refusals",
});

const sessionFamily = defineRestRouter(ProbeApi)
  .withNamespace("probe-session")
  .withVersion("2026-08-07")
  .get("/", "readSession")
  .withAccess(WHOEVER_IS_THERE)
  .withMiddleware(
    adminActor,
    adminAuthSession,
    mcpAuthorizeApprover,
    userAvatarCaller,
    playgroundRestCaller,
  )
  .withOutput(z.object({ facts: z.unknown() }))
  .handle((_args, actor, authSession, approver, avatar, playground) => ({
    facts: { actor, authSession, approver, avatar, playground },
  }))
  .build()
  .router();

const proxyFamily = defineRestRouter(ProbeApi)
  .withNamespace("probe-proxy")
  .withVersion("2026-08-07")
  .get("/", "readProxy")
  .withAccess(WHOEVER_IS_THERE)
  .withMiddleware(playgroundRestExecutionProxy)
  .withOutput(z.object({ proxy: z.string() }))
  .handle((_args, proxy) => ({ proxy }))
  .build()
  .router();

/** The peer Apps a fact reads, answering exactly what these tests need. */
function peersWith(overrides: { permitted?: boolean } = {}): TransportPeers {
  const peer = {
    hasPermission: async () => overrides.permitted ?? true,
    read: () => "probe",
  };

  return { app: (() => peer) as never, find: () => void 0 };
}

const app = () => ({ read: () => "probe" });

/** One process, one session answer, however many facts ask for it. */
function hostResolving(
  caller: ApiRestBrowserCaller | null,
  options: { permitted?: boolean; executionProxyBaseUrl?: string } = {},
): { host: ApiRestHost; resolutions: () => number } {
  let resolutions = 0;

  const host = ApiRestHost.create({
    peers: peersWith(options.permitted === undefined ? {} : { permitted: options.permitted }),
    config: {
      browserSession: async () => {
        resolutions += 1;
        return caller;
      },
      ...(options.executionProxyBaseUrl
        ? { executionProxyBaseUrl: options.executionProxyBaseUrl }
        : {}),
    },
  });

  return { host, resolutions: () => resolutions };
}

const SIGNED_IN: ApiRestBrowserCaller = {
  authSessionId: "session-1",
  userId: "user-1",
  email: "operator@example.com",
  impersonator: { id: "staff-1", email: "staff@example.com" },
};

async function factsFrom(host: ApiRestHost, headers: Record<string, string> = {}) {
  const response = await host
    .mount(sessionFamily, app)
    .request("/api/probe-session/2026-08-07/", { headers });

  expect(response.status).toBe(200);

  return ((await response.json()) as { facts: Record<string, unknown> }).facts;
}

describe("given a request carrying a verified browser session", () => {
  describe("when a family declares this process's session facts", () => {
    it("answers the back office both the person and the raw auth session", async () => {
      const facts = await factsFrom(hostResolving(SIGNED_IN).host);

      expect(facts.actor).toEqual({
        id: "user-1",
        email: "operator@example.com",
        impersonator: { id: "staff-1", email: "staff@example.com" },
      });
      expect(facts.authSession).toEqual({ id: "session-1" });
    });

    it("answers the consent page and the avatar door the same person", async () => {
      const facts = await factsFrom(hostResolving(SIGNED_IN).host);

      expect(facts.approver).toEqual({ user: { id: "user-1" } });
      expect(facts.avatar).toEqual({ apiKeyProjectId: null, userId: "user-1" });
    });

    it("asks the playground's permission at the project the header names", async () => {
      const facts = await factsFrom(hostResolving(SIGNED_IN, { permitted: true }).host, {
        "x-project-id": "project-1",
      });

      expect(facts.playground).toEqual({ kind: "signedIn", userId: "user-1", permitted: true });
    });

    it("holds the playground unpermitted where the request named no project", async () => {
      const facts = await factsFrom(hostResolving(SIGNED_IN, { permitted: true }).host);

      expect(facts.playground).toEqual({ kind: "signedIn", userId: "user-1", permitted: false });
    });

    it("verifies the cookie once however many facts read it", async () => {
      const resolving = hostResolving(SIGNED_IN);
      await factsFrom(resolving.host);

      expect(resolving.resolutions()).toBe(1);
    });
  });
});

describe("given a cookie the verifier accepted whose live session is gone", () => {
  describe("when the back office's two facts are resolved", () => {
    it("keeps the auth session an impersonation ends against, and names no person", async () => {
      const facts = await factsFrom(hostResolving({ authSessionId: "session-1" }).host);

      expect(facts.authSession).toEqual({ id: "session-1" });
      expect(facts.actor).toBeNull();
      expect(facts.approver).toBeNull();
      expect(facts.playground).toEqual({ kind: "anonymous" });
    });
  });
});

describe("given a deployment that composed no browser session verifier", () => {
  describe("when a session fact is resolved", () => {
    it("answers every one of them its own refusing variant", async () => {
      const host = ApiRestHost.create({ peers: peersWith(), config: {} });
      const facts = await factsFrom(host);

      expect(facts.actor).toBeNull();
      expect(facts.authSession).toBeNull();
      expect(facts.approver).toBeNull();
      expect(facts.avatar).toEqual({ apiKeyProjectId: null, userId: null });
      expect(facts.playground).toEqual({ kind: "anonymous" });
    });
  });
});

describe("given a deployment that named no NLP engine", () => {
  describe("when the playground asks where its execution proxy answers", () => {
    it("refuses by name rather than streaming at an address that is not there", async () => {
      const host = ApiRestHost.create({ peers: peersWith(), config: {} });

      const response = await host
        .mount(proxyFamily, app)
        .request("/api/probe-proxy/2026-08-07/");

      expect(response.status).toBe(503);
    });

    it("answers the address this deployment joined where it named one", async () => {
      const { host } = hostResolving(null, {
        executionProxyBaseUrl: "http://127.0.0.1:5561/go/proxy/v1",
      });

      const response = await host
        .mount(proxyFamily, app)
        .request("/api/probe-proxy/2026-08-07/");

      expect(await response.json()).toEqual({ proxy: "http://127.0.0.1:5561/go/proxy/v1" });
    });
  });
});

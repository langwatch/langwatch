/**
 * Every key door hands its caller the key's owning user, and no actor for a key no person
 * owns (ARCHITECTURE §8).
 */

import { createServer } from "node:http";

import {
  ApiKeyApi,
  type ApiKeyTokenResolutionInput,
  type OrganizationApiKeyResolution,
  type ResolvedApiKeyCredential,
} from "@langwatch/api-key-contract";
import { anyAuthenticated } from "@langwatch/api/access";
import { type NodeHandler, TransportSelection } from "@langwatch/api/hosting";
import { defineRestRouter } from "@langwatch/api/rest";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { moduleApi, transportPeersOf } from "@langwatch/kernel";
import { createLogger } from "@langwatch/observability";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { apiSurface, bearerDoor } from "../api-surface.ts";

const PROJECT = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
};

function projectKey(apiKeyId: string, userId: string | null): ResolvedApiKeyCredential {
  return {
    type: "apiKey",
    apiKeyId,
    userId,
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
  };
}

function organizationKey(apiKeyId: string, userId: string | null): OrganizationApiKeyResolution {
  return { ok: true, resolved: { type: "apiKey-org", apiKeyId, userId, organizationId: "org-1" } };
}

const projectTokens = new Map<string, ResolvedApiKeyCredential>([
  ["sk-lw-owned", projectKey("key-owned", "user-1")],
  ["sk-lw-unowned", projectKey("key-unowned", null)],
  ["legacy-key", { type: "legacyProjectKey", project: PROJECT }],
]);
const organizationTokens = new Map<string, OrganizationApiKeyResolution>([
  ["sk-lw-org-owned", organizationKey("key-org-owned", "user-2")],
  ["sk-lw-org-unowned", organizationKey("key-org-unowned", null)],
]);

const apiKeys: Pick<ApiKeyApi, "findResolvedToken" | "resolveOrganizationToken" | "markUsed"> = {
  findResolvedToken: ({ token }: ApiKeyTokenResolutionInput) =>
    Promise.resolve(projectTokens.get(token) ?? null),
  resolveOrganizationToken: ({ token }) =>
    Promise.resolve(organizationTokens.get(token) ?? { ok: false, reason: "unusable_credential" }),
  markUsed: () => {},
};
const refuseEverything = () => Promise.reject(new Error("an identified route asks no permission"));
const peers = new Map<unknown, unknown>([
  [ApiKeyApi, apiKeys],
  [AuthzApi, { hasApiKeyPermission: refuseEverything, getApiKeyProjectDecision: refuseEverything }],
  [OrganizationApi, { getSettings: () => Promise.resolve({}) }],
  [AuditLogApi, {}],
]);

const members: ProcessMemberSource = {
  order: [],
  read: (name) => {
    throw new Error(`the key doors read no ${name}`);
  },
  close: () => Promise.resolve(),
  [Symbol.asyncDispose]: () => Promise.resolve(),
};

interface WhoApi {
  whoCalled(input: { actor: unknown }): Promise<{ actor: unknown }>;
}
const WhoApi = moduleApi<WhoApi>()("annotation");
const who: WhoApi = { whoCalled: ({ actor }) => Promise.resolve({ actor }) };

function familyOn(credential: "project" | "organization" | "apiKey") {
  return defineRestRouter(WhoApi)
    .withNamespace(`who-${credential.toLowerCase()}`)
    .withVersion("2026-09-24")
    .withCredential(credential)
    .get("/", `who${credential}`)
    .withAccess(anyAuthenticated({ reason: "The test reads back who the door resolved." }))
    .withOutput(z.object({ actor: z.unknown() }))
    .withDocs({ summary: "Who the door resolved" })
    .handle(async ({ app, actor }) => app.whoCalled({ actor }))
    .build();
}

const surface = apiSurface({
  members,
  logger: createLogger("process-server:key-owner-actor-test"),
  stores: { database: false, redis: false },
  bundle: void 0,
  storage: {},
  internalBearers: new Map(),
  instanceAdmin: bearerDoor({ name: "instance-admin", token: void 0 }),
  trustedProxies: void 0,
  executionProxyBaseUrl: void 0,
  production: false,
  selection: TransportSelection.create().rest().browserBundle(false),
})(transportPeersOf((token) => peers.get(token)));
const rest = surface.hosts.rest;
if (!rest) throw new Error("the surface selected REST");
for (const credential of ["project", "organization", "apiKey"] as const)
  rest.mount(familyOn(credential).router(), () => who);

const handler = surface.serve();
if (!isNodeHandler(handler)) throw new Error("the api surface composed no handler");
const server = createServer(handler);
let origin = "";

beforeAll(async () => {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("the test server has no port");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(() => new Promise<void>((closed) => server.close(() => closed())));

async function actorThrough(door: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(`${origin}/api/who-${door.toLowerCase()}`, { headers });
  expect(response.status).toBe(200);
  const body: { actor: unknown } = await response.json();
  return body.actor;
}

describe("the key doors' actor", () => {
  describe("given a project key a person owns", () => {
    it("is that person on the project door", async () => {
      expect(
        await actorThrough("project", {
          authorization: "Bearer sk-lw-owned",
          "x-project-id": "project-1",
        }),
      ).toEqual({ type: "user", id: "user-1" });
    });

    it("is that person on the key door", async () => {
      expect(
        await actorThrough("apiKey", {
          authorization: "Bearer sk-lw-owned",
          "x-project-id": "project-1",
        }),
      ).toEqual({ type: "user", id: "user-1" });
    });
  });

  describe("given a project key no person owns", () => {
    it("is no one on the project door", async () => {
      expect(
        await actorThrough("project", {
          authorization: "Bearer sk-lw-unowned",
          "x-project-id": "project-1",
        }),
      ).toBeNull();
    });

    it("is no one on the key door", async () => {
      expect(
        await actorThrough("apiKey", {
          authorization: "Bearer sk-lw-unowned",
          "x-project-id": "project-1",
        }),
      ).toBeNull();
    });
  });

  describe("given a legacy project key", () => {
    it("is no one on the project door", async () => {
      expect(await actorThrough("project", { "x-auth-token": "legacy-key" })).toBeNull();
    });
  });

  describe("given an organization key", () => {
    it("is its owner on the organization door when a person owns it", async () => {
      expect(
        await actorThrough("organization", { authorization: "Bearer sk-lw-org-owned" }),
      ).toEqual({ type: "user", id: "user-2" });
    });

    it("is no one on the organization door when no person owns it", async () => {
      expect(
        await actorThrough("organization", { authorization: "Bearer sk-lw-org-unowned" }),
      ).toBeNull();
    });
  });
});

function isNodeHandler(value: unknown): value is NodeHandler {
  return typeof value === "function";
}

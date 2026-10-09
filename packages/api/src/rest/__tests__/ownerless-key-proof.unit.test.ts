/**
 * A project key that stands for nobody (a legacy project key, an ownerless API key) reads its
 * own project's traces on a proof the door mints as its own, as main did, and never another's.
 */
import {
  internalActor,
  sealAuthorization,
  type Actor,
  type RestResolvedProjectCredential,
} from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { createErrorHandler } from "../../errors.ts";
import type { RestIdentity } from "../../hosting/api-door.ts";
import { OWNERLESS_PROJECT_KEY_PROOF_CODE_PATH, recordProjectCredential } from "../credential.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

type TracesApi = { search(): Promise<{ read: boolean }> };

const TracesApi = moduleApi<TracesApi>()("trace");
const VERSION = "2026-10-09";
const PROJECT = {
  id: "project-1",
  slug: "project",
  name: "Project",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

const LEGACY: RestResolvedProjectCredential = { type: "legacyProjectKey", project: PROJECT };

function apiKey(userId: string | null): RestResolvedProjectCredential {
  return {
    type: "apiKey",
    apiKeyId: "key-1",
    userId,
    organizationId: "org-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
  };
}

const routes = defineRestRouter(TracesApi)
  .withNamespace("ownerless-proof")
  .withVersion(VERSION)
  .post("/search", "search")
  .withPermission("traces:view")
  .withOutput(z.object({ read: z.boolean() }))
  .handle(({ app }) => app.search())
  .build()
  .router();

type Minted = Readonly<{ actor: Actor; projectId: string }>;

/** A door that admits the key at `scope` and records what it resolved. */
async function search({
  credential,
  scope,
  actor = null,
}: {
  credential: RestResolvedProjectCredential;
  scope: string;
  actor?: Actor | null;
}) {
  const minted: Minted[] = [];
  const ran: string[] = [];
  const door: RestIdentity = {
    authenticate: ({ request }) => {
      recordProjectCredential(request, credential);
      return { actor, scope: { tier: "project", id: scope } };
    },
  };
  const authorization = {
    forRequest: () => ({
      ...authorizationPort.forRequest(),
      authorization: async (input: Minted) => {
        minted.push({ actor: input.actor, projectId: input.projectId });
        return sealAuthorization({
          actor: input.actor,
          principal: { type: "internal", codePath: OWNERLESS_PROJECT_KEY_PROOF_CODE_PATH },
          scope: { organizationId: "org-1" },
          grants: [
            { projectId: input.projectId, permissions: ["traces:view"], via: [], kind: "own" },
          ],
          expiresAt: Number.MAX_SAFE_INTEGER,
          purpose: { kind: "route", route: "trace.search" },
        });
      },
    }),
  };
  const app: TracesApi = {
    search: async () => {
      ran.push("search");
      return { read: true };
    },
  };

  const response = await createRestRuntime({ authorization, identity: door })
    .mount(routes, { app: () => app, onError: createErrorHandler() })
    .request(`/api/ownerless-proof/${VERSION}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-auth-token": "key" },
      body: "{}",
    });

  return { response, minted, ran };
}

const OWN_PROOF = { actor: internalActor(OWNERLESS_PROJECT_KEY_PROOF_CODE_PATH) };

describe("a trace read with a key that stands for nobody", () => {
  describe("given a legacy project key at its own project", () => {
    it("reads on a proof minted as the door's own for that project", async () => {
      const { response, minted, ran } = await search({
        credential: LEGACY,
        scope: "project-1",
      });

      expect(response.status).toBe(200);
      expect(minted).toEqual([{ ...OWN_PROOF, projectId: "project-1" }]);
      expect(ran).toEqual(["search"]);
    });
  });

  describe("given an API key no person owns, at its own project", () => {
    it("reads on a proof minted as the door's own for that project", async () => {
      const { response, minted } = await search({ credential: apiKey(null), scope: "project-1" });

      expect(response.status).toBe(200);
      expect(minted).toEqual([{ ...OWN_PROOF, projectId: "project-1" }]);
    });
  });

  describe("given either key at a project other than its own", () => {
    it.each([
      ["legacy project key", LEGACY],
      ["ownerless API key", apiKey(null)],
    ])("refuses the %s 403 without minting or reading", async (_kind, credential) => {
      const { response, minted, ran } = await search({ credential, scope: "project-2" });

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("permission_denied");
      expect(minted).toEqual([]);
      expect(ran).toEqual([]);
    });
  });

  describe("given a key a person owns", () => {
    it("mints the proof for that person, as before", async () => {
      const person: Actor = { type: "user", id: "user-1" };
      const { minted } = await search({
        credential: apiKey("user-1"),
        scope: "project-1",
        actor: person,
      });

      expect(minted).toEqual([{ actor: person, projectId: "project-1" }]);
    });
  });
});

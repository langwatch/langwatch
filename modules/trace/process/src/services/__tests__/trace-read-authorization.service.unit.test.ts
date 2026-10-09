/** ADR-175: Trace mints the proof its reads carry through authz, by the caller's kind. */
import type { Authorization } from "@langwatch/authorization";
import { ownProof } from "@langwatch/authorization/testing";
import type {
  AuthzApi,
  AuthzMintAuthorizationInput,
  AuthzMintInternalAuthorizationInput,
} from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { recordingAuthorizedReads } from "../../repositories/clickhouse/__tests__/support/authorized-reads.support.ts";
import { TraceReadAuthorizationService } from "../trace-read-authorization.service.ts";

const NOW = 1_800_000_000_000;
const PROJECT = "proj_aggregate";

function minting() {
  const routed: AuthzMintAuthorizationInput[] = [];
  const internal: AuthzMintInternalAuthorizationInput[] = [];
  const proof: Authorization = ownProof({ projectId: PROJECT, now: NOW });
  const service = TraceReadAuthorizationService.create({
    authz: createApiFixture<AuthzApi>({
      mintAuthorization: async (input) => {
        routed.push(input);
        return proof;
      },
      mintInternalAuthorization: async (input) => {
        internal.push(input);
        return proof;
      },
    }),
    reads: recordingAuthorizedReads().reads,
  });
  return { service, routed, internal, proof };
}

describe("TraceReadAuthorizationService", () => {
  describe("given a signed-in user reading a project's traces", () => {
    describe("when the route asks for its proof", () => {
      it("mints the user's proof under traces:view, shared grants included", async () => {
        const { service, routed, internal, proof } = minting();

        const minted = await service.forCaller({
          actor: { type: "user", id: "ana" },
          projectId: PROJECT,
          route: "traces.list",
        });

        expect(minted).toBe(proof);
        expect(internal).toEqual([]);
        expect(routed).toEqual([
          {
            actor: { type: "user", id: "ana" },
            principal: { type: "user", id: "ana" },
            permission: "traces:view",
            scope: { projectId: PROJECT },
            purpose: { kind: "route", route: "traces.list" },
          },
        ]);
      });
    });
  });

  describe("given an API key reading a project's traces", () => {
    describe("when the route asks for its proof", () => {
      it("mints it for the key as the principal", async () => {
        const { service, routed } = minting();

        await service.forCaller({
          actor: { type: "api_key", id: "key_1" },
          projectId: PROJECT,
          route: "api.traces.search",
        });

        expect(routed[0]?.principal).toEqual({ type: "apiKey", id: "key_1" });
      });
    });
  });

  describe("given platform code reading a project on its own behalf", () => {
    describe("when it asks for the own-only proof", () => {
      it("mints an internal proof that widens through no grant", async () => {
        const { service, routed, internal } = minting();

        await service.ownOnly({ projectId: PROJECT, entry: "share.read" });

        expect(routed).toEqual([]);
        expect(internal).toEqual([
          {
            actor: { type: "internal", codePath: "modules/trace/process:share.read" },
            projectId: PROJECT,
            permission: "traces:view",
            purpose: { kind: "operator", entry: "share.read" },
          },
        ]);
      });
    });
  });

  describe("given a compiled filter handed to a read that writes its own statement", () => {
    describe("when the filter is expanded for that read's own project", () => {
      it("replaces each marker with the own-only fence and keeps the filter's parameters", async () => {
        const { service, internal } = minting();

        const expanded = await service.expandForOwnProject({
          projectId: PROJECT,
          entry: "rest.traces.search",
          filterWhere: {
            sql: "{{tenantScope:OccurredAt}} AND TraceName = {name:String}",
            params: { name: "checkout" },
          },
        });

        expect(internal.map((input) => input.projectId)).toEqual([PROJECT]);
        expect(expanded).toEqual({
          sql: "(TenantId IN ({tenantScope_all:Array(String)})) AND TraceName = {name:String}",
          params: { name: "checkout", tenantScope_all: [PROJECT] },
        });
      });

      it("refuses a fragment that names a tenant itself", async () => {
        const { service } = minting();

        await expect(
          service.expandForOwnProject({
            projectId: PROJECT,
            entry: "rest.traces.search",
            filterWhere: { sql: "TenantId = {tenantId:String}", params: { tenantId: PROJECT } },
          }),
        ).rejects.toMatchObject({ violation: { kind: "hand-written-tenant-predicate" } });
      });
    });
  });
});

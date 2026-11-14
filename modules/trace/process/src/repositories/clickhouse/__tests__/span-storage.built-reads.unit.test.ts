/**
 * A trace's full-span reads are built under the reader's proof (ADR-202): one reader statement
 * over the proof's tenants with the tenant setting, the single-trace memory ceiling and the
 * stored_spans id bound. Spec: modules/trace/specs/trace-read-service.feature
 */
import type { CompiledWhere } from "@langwatch/authorization";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { braidedProof, ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { SpanStorageClickHouseRepository } from "../span-storage.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

const PROJECT = "project-1";
const OWNER = "project-owner";
const at = { traceId: "trace-1", occurredAtMs: 1_700_000_000_000 };
const authorization = ownProof({ projectId: PROJECT });
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

/** A reader answering no rows, keeping each request it was sent; the raw client refuses. */
function reader() {
  const requests: ReadRequest[] = [];
  const refuse = () => Promise.reject(new Error("a built read never reaches the raw client"));
  const repository = SpanStorageClickHouseRepository.create({
    resolveClient: refuse,
    clickhouse: { as: () => ({ query: refuse }) } as never,
    reader: clickHouseQueryClientDouble({
      async read(request: ReadRequest) {
        requests.push(request);
        return { rows: [] };
      },
    }),
  });
  return { repository, requests };
}

const reads = {
  "full spans": (repository: SpanStorageClickHouseRepository) =>
    repository.findSpansByTraceId({ authorization, ...at }),
  "normalized spans": (repository: SpanStorageClickHouseRepository) =>
    repository.findNormalizedSpansByTraceId({ authorization, ...at }),
  "stored spans": (repository: SpanStorageClickHouseRepository) =>
    repository.findStoredSpansByTraceId({ authorization, ...at }),
};

describe("SpanStorageClickHouseRepository built reads", () => {
  describe.each(Object.entries(reads))("given the %s read", (_name, read) => {
    describe("when the reader's proof covers its own project", () => {
      /** @scenario "Every full-span read of a trace is fenced by the reader's proof" */
      it("sends one reader statement over the proof's tenants with the tenant setting", async () => {
        const { repository, requests } = reader();

        await read(repository);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.table).toBe("stored_spans");
        expect(requests[0]?.statement).toMatchObject({
          kind: "tenant",
          identity: "reader",
          tenantIds: [PROJECT],
          settings: { SQL_langwatch_tenant_ids: PROJECT },
        });
        const sql = requests[0]?.statement.sql ?? "";
        expect(sql).toContain("TenantId IN ({tenantScope_own:Array(String)})");
        expect(sql).toContain("max(UpdatedAt)");
        expect(sql).toMatch(/SETTINGS[^]*max_memory_usage/);
        expect(requests[0]?.idBound).toMatchObject({
          occurredAtHint: at.occurredAtMs,
          fallback: "unbounded",
        });
      });
    });
  });

  describe("given the full spans read of a braided reader that asks for spans", () => {
    /** @scenario "Every full-span read of a trace is fenced by the reader's proof" */
    it("reads the owner's spans under the braid's condition, never naming a tenant itself", async () => {
      const { repository, requests } = reader();
      const braided = braidedProof({
        projectId: PROJECT,
        braids: [{ owner: OWNER, compiledWhere: WEB }],
      });

      await repository.findSpansByTraceId({ authorization: braided, reads: "spans", ...at });

      expect(requests).toHaveLength(1);
      const sql = requests[0]?.statement.sql ?? "";
      expect(sql).toContain("{tenantScope_c0_ids:Array(String)}");
      expect(sql).not.toContain(OWNER);
      expect(sql).not.toContain("'web'");
    });
  });
});

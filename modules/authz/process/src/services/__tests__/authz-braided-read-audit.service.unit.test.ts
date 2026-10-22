/**
 * ADR-183 §8: a read showing braided spans is audited once per actor, reader and owner per
 * window, naming the braids and never a span.
 * @see modules/authz/specs/braids.feature
 */
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { LedgerBraidRow } from "../../repositories/authz-ledger-read.repository.ts";
import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzAuditTrailRepository } from "../../repositories/memory/memory.authz-audit-trail.repository.ts";
import { AuthzBraidedReadAuditService } from "../authz-braided-read-audit.service.ts";

const ORG = "org_acme";
const READER = "proj_orchestrator";
const OWNER = "proj_specialists";
const SAM = { type: "user", id: "user_sam" } as const;

function braid(grantId: string, ownerProjectId: string): LedgerBraidRow {
  return {
    grantId,
    ownerProjectId,
    readerProjectId: READER,
    condition: null,
    expiresAt: null,
    createdByUserId: "user_ana",
    occurredAt: fromDate(new Date(0)),
    revokedReason: null,
    isLive: true,
    replacesGrantId: null,
  };
}

function setup() {
  const memory = AuthzMemoryStore.create();
  let nowMs = Date.UTC(2026, 9, 21, 12, 0, 0);
  const service = AuthzBraidedReadAuditService.create({
    auditTrail: MemoryAuthzAuditTrailRepository.create({ memory }),
    lineage: {
      findProjectLineage: async ({ projectId }: { projectId: string }) =>
        projectId === READER
          ? { projectId, organizationId: ORG, teamId: "team_web", kind: "application" }
          : null,
    } as never,
    reads: {
      findBraids: async () => [braid("grant_web", OWNER), braid("grant_billing", "proj_billing")],
    },
    now: () => nowMs,
  });
  return {
    service,
    rows: () => memory.auditLogs.filter((row) => row.action === "braided_spans.viewed"),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("AuthzBraidedReadAuditService", () => {
  describe("when sam opens three traces holding the same owner's spans within five minutes", () => {
    it("writes one row naming sam, the reader, the owner and the braid, and no span", async () => {
      const { service, rows, advance } = setup();

      for (let i = 0; i < 3; i++) {
        await service.recordBraidedSpansView({
          actor: SAM,
          readerProjectId: READER,
          ownerProjectIds: [OWNER],
        });
        advance(60_000);
      }

      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toMatchObject({
        userId: "user_sam",
        organizationId: ORG,
        metadata: {
          actor: SAM,
          readerProjectId: READER,
          ownerProjectId: OWNER,
          braidIds: ["grant_web"],
        },
      });
    });
  });

  describe("when the window passes", () => {
    it("writes another row", async () => {
      const { service, rows, advance } = setup();
      const view = { actor: SAM, readerProjectId: READER, ownerProjectIds: [OWNER] };

      await service.recordBraidedSpansView(view);
      advance(5 * 60_000 + 1);
      await service.recordBraidedSpansView(view);

      expect(rows()).toHaveLength(2);
    });
  });

  describe("when one read shows spans of two owners", () => {
    it("writes a row per owner and none for the reader itself", async () => {
      const { service, rows } = setup();

      await service.recordBraidedSpansView({
        actor: SAM,
        readerProjectId: READER,
        ownerProjectIds: [OWNER, "proj_billing", READER, OWNER],
      });

      expect(rows().map((row) => row.metadata.ownerProjectId)).toEqual([OWNER, "proj_billing"]);
    });
  });

  describe("when platform code reads", () => {
    it("writes nothing", async () => {
      const { service, rows } = setup();

      await service.recordBraidedSpansView({
        actor: { type: "internal", codePath: "trace/test" },
        readerProjectId: READER,
        ownerProjectIds: [OWNER],
      });

      expect(rows()).toHaveLength(0);
    });
  });
});

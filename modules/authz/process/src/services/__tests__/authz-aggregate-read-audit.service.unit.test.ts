import { describe, expect, it, vi } from "vitest";

import type { RecordAggregateReadCommandData } from "../../eventing/authz-aggregate-read.events.ts";
import {
  AGGREGATE_READ_AUDIT_WINDOW_MS as WINDOW_MS,
  type AggregateRead,
  AuthzAggregateReadAuditService,
} from "../authz-aggregate-read-audit.service.ts";

const read = (overrides: Partial<AggregateRead> = {}): AggregateRead => ({
  actorUserId: "ana",
  organizationId: "org_acme",
  aggregateProjectId: "proj_company_view",
  ...overrides,
});

function harness() {
  let nowMs = 1_800_000_000_000;
  const send = vi.fn(async (_data: RecordAggregateReadCommandData) => undefined);
  const audit = AuthzAggregateReadAuditService.create({ now: () => nowMs });
  audit.connect({ send });
  return {
    send,
    audit,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("AuthzAggregateReadAuditService", () => {
  describe("when a user reads an aggregate", () => {
    it("records the fact under the organization's tenant at the read's time", async () => {
      const { send, audit } = harness();
      await audit.record(read());
      expect(send).toHaveBeenCalledWith({
        ...read(),
        tenantId: "org_acme",
        occurredAt: 1_800_000_000_000,
      });
    });
  });

  describe("when the same actor reads the same aggregate twice inside the window", () => {
    it("records once", async () => {
      const { send, audit, advance } = harness();
      await audit.record(read());
      advance(WINDOW_MS - 1);
      await audit.record(read());
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the window has passed", () => {
    it("records again", async () => {
      const { send, audit, advance } = harness();
      await audit.record(read());
      advance(WINDOW_MS);
      await audit.record(read());
      expect(send).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the requests of one page arrive together", () => {
    it("records once for all of them", async () => {
      const { send, audit } = harness();
      await Promise.all([audit.record(read()), audit.record(read()), audit.record(read())]);
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("when another actor or another aggregate is read", () => {
    it("records each pair on its own", async () => {
      const { send, audit } = harness();
      await audit.record(read());
      await audit.record(read({ actorUserId: "sam" }));
      await audit.record(read({ aggregateProjectId: "proj_other_view" }));
      expect(send).toHaveBeenCalledTimes(3);
    });
  });

  describe("when recording fails", () => {
    it("passes the failure on and remembers nothing, so the next read retries", async () => {
      const { send, audit } = harness();
      send.mockRejectedValueOnce(new Error("queue down"));
      await expect(audit.record(read())).rejects.toThrow("queue down");
      await audit.record(read());
      expect(send).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the pipeline is not registered in this process", () => {
    it("refuses by name", async () => {
      const audit = AuthzAggregateReadAuditService.create();
      await expect(audit.record(read())).rejects.toThrow("authz_aggregate_read");
    });
  });
});

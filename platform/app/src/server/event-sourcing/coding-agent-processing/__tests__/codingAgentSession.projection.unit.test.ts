import { describe, expect, it } from "vitest";
import { initCodingAgentSessionState } from "../coding-agent-session.derivation";
import {
  CODING_AGENT_SESSION_STATE_VERSION,
  codingAgentSessionRow,
} from "../codingAgentSession.projection";

const context = {
  tenantId: "project-1",
  key: "session-1",
  version: CODING_AGENT_SESSION_STATE_VERSION,
  writtenAt: new Date("2026-07-01T00:00:00.000Z"),
  retentionDays: 30,
};

const laterWrite = { ...context, writtenAt: new Date("2026-07-02T00:00:00Z") };

describe("the coding-agent session row mapping", () => {
  describe("given a session that has never been stored", () => {
    it("stamps CreatedAt with this write's instant", () => {
      const row = codingAgentSessionRow.toRow(
        initCodingAgentSessionState(),
        context,
      );
      expect(row.CreatedAt).toEqual(context.writtenAt);
    });
  });

  describe("given a stored row is read back and contributed to again", () => {
    it("keeps the first write's CreatedAt instead of moving it forward", () => {
      const first = codingAgentSessionRow.toRow(
        initCodingAgentSessionState(),
        context,
      );
      const reread = codingAgentSessionRow.fromRow(first);
      const second = codingAgentSessionRow.toRow(reread, laterWrite);

      expect(second.CreatedAt).toEqual(context.writtenAt);
      expect(second.UpdatedAt).toEqual(laterWrite.writtenAt);
    });

    it("round-trips CreatedAt into state so it is readable at all", () => {
      const row = codingAgentSessionRow.toRow(
        initCodingAgentSessionState(),
        context,
      );
      expect(codingAgentSessionRow.fromRow(row).createdAt).toBe(
        context.writtenAt.getTime(),
      );
    });
  });
});

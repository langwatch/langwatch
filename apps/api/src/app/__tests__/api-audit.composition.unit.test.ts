import type {
  AuditLogApi,
  AuditLogHistoryEntry,
  RecordAuditLogCommand,
} from "@langwatch/audit-log-contract";
import { describe, expect, it } from "vitest";

import { ApiAuditAbsenceReport, composeApiAudit } from "../api-audit.composition.ts";

type RecordedRow = {
  userId: string;
  action: string;
  organizationId?: string;
  projectId?: string;
  args?: unknown;
  error?: string;
};

/** The audit log the trail records on, holding every row it was handed. */
class RecordingAuditLog implements AuditLogApi {
  readonly rows: RecordedRow[] = [];

  async record(command: RecordAuditLogCommand): Promise<void> {
    this.rows.push(command);
  }

  async listEntityHistory(): Promise<AuditLogHistoryEntry[]> {
    return [];
  }
}

function recordingAuditLog(): { rows: RecordedRow[]; client: AuditLogApi } {
  const client = new RecordingAuditLog();
  return { rows: client.rows, client };
}

class RecordingAbsence extends ApiAuditAbsenceReport {
  readonly reasons: string[] = [];

  absent(because: string): void {
    this.reasons.push(because);
  }
}

describe("given the API process composed its own audit trail", () => {
  describe("when a completed mutation is recorded", () => {
    /** @scenario "A recorded mutation lands on the audit trail with the scopes it named" */
    it("writes one row carrying the actor, the action and the arguments", async () => {
      const { rows, client } = recordingAuditLog();
      const audit = composeApiAudit({ auditLog: () => client });

      await audit.record({
        actorId: "user_1",
        path: "organization.update",
        input: { organizationId: "org_1", name: "Acme" },
        error: null,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.userId).toBe("user_1");
      expect(rows[0]?.action).toBe("organization.update");
      expect(rows[0]?.args).toEqual({ organizationId: "org_1", name: "Acme" });
    });

    /** @scenario "A recorded mutation lands on the audit trail with the scopes it named" */
    it("derives the organization and project the row is filed under from the arguments", async () => {
      const { rows, client } = recordingAuditLog();
      const audit = composeApiAudit({ auditLog: () => client });

      await audit.record({
        actorId: "user_1",
        path: "project.update",
        input: { organizationId: "org_1", projectId: "project_1" },
        error: null,
      });

      expect(rows[0]?.organizationId).toBe("org_1");
      expect(rows[0]?.projectId).toBe("project_1");
    });

    it("stores a failure that is not an Error rather than dropping it", async () => {
      const { rows, client } = recordingAuditLog();
      const audit = composeApiAudit({ auditLog: () => client });

      await audit.record({
        actorId: "user_1",
        path: "project.update",
        input: {},
        error: "FORBIDDEN",
      });

      expect(rows[0]?.error).toContain("FORBIDDEN");
    });
  });

  describe("when the connection is opened after the trail is composed", () => {
    /**
     * @scenario "The trail resolves its connection when a row is written, not when it is composed"
     */
    it("records through the connection the process opened later", async () => {
      const { rows, client } = recordingAuditLog();
      let opened: AuditLogApi | undefined = void 0;
      const audit = composeApiAudit({ auditLog: () => opened });

      opened = client;
      await audit.record({ actorId: "user_1", path: "project.update", input: {}, error: null });

      expect(rows).toHaveLength(1);
    });
  });

  describe("when the process opened no database", () => {
    /**
     * @scenario "The trail resolves its connection when a row is written, not when it is composed"
     */
    it("names the absent collaborator instead of failing the call it was recording", async () => {
      const report = new RecordingAbsence();
      const audit = composeApiAudit({ auditLog: () => void 0, report });

      await expect(
        audit.record({ actorId: "user_1", path: "project.update", input: {}, error: null }),
      ).resolves.toBeUndefined();
      expect(report.reasons).toEqual(["audit-log feature"]);
    });
  });
});

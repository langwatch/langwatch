import { describe, expect, it } from "vitest";
import { redactOutboxPayloadForAudit } from "../pgAuditAdapter";
import type { CadenceStagePayload, SettleStagePayload } from "../payload";
import { TRIGGER_NOTIFY_REACTOR_NAME } from "../payload";

const SECRET_INPUT = "What is the patient's diagnosis?";
const SECRET_OUTPUT = "The patient has a suspected fracture.";

/**
 * A payload that DOES carry trace content on `match`.
 *
 * The live payload type no longer permits this — which is the point: the
 * redactor is the last line of defence for the day someone widens the payload
 * (it extends `Record<string, unknown>`, so the type will not stop them) and
 * quietly starts writing customer text onto a durable, unpruned Postgres table.
 * The cast is deliberate; it is how the test reaches past the type to the
 * failure mode the redactor exists to prevent.
 */
function makeCadence(): CadenceStagePayload {
  return {
    stage: "cadence",
    projectId: "proj-1",
    triggerId: "trig-1",
    reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
    auditDedupKey: "proj-1/trig-1:trace:trace-1",
    actionClass: "notify",
    match: {
      traceId: "trace-1",
      input: SECRET_INPUT,
      output: SECRET_OUTPUT,
    },
  } as unknown as CadenceStagePayload;
}

function makeSettle(): SettleStagePayload {
  return {
    stage: "settle",
    projectId: "proj-1",
    triggerId: "trig-1",
    traceId: "trace-1",
    reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
    auditDedupKey: "proj-1/trig-1:trace:trace-1",
    actionClass: "notify",
  };
}

describe("redactOutboxPayloadForAudit", () => {
  describe("given a cadence payload carrying the matched trace's content", () => {
    it("drops the trace's input and output", () => {
      const redacted = redactOutboxPayloadForAudit(makeCadence());

      // ReactorOutbox is durable, backed up, and unpruned — content written
      // here is customer text at rest in Postgres that outlives the trace.
      const serialized = JSON.stringify(redacted);
      expect(serialized).not.toContain(SECRET_INPUT);
      expect(serialized).not.toContain(SECRET_OUTPUT);
      expect(serialized).not.toContain("patient");
    });

    it("keeps the identity an operator needs to trace the dispatch", () => {
      const redacted = redactOutboxPayloadForAudit(makeCadence()) as Record<
        string,
        unknown
      >;

      expect(redacted.projectId).toBe("proj-1");
      expect(redacted.triggerId).toBe("trig-1");
      expect(redacted.stage).toBe("cadence");
      expect(redacted.actionClass).toBe("notify");
      expect(redacted.auditDedupKey).toBe("proj-1/trig-1:trace:trace-1");
      // The trace id is the dispatch's identity (and already the row's
      // dedupKey) — it is not content, and an operator needs it.
      expect(redacted.match).toEqual({ traceId: "trace-1" });
    });
  });

  describe("given a settle payload", () => {
    it("passes through unchanged — it never carried content in the first place", () => {
      const payload = makeSettle();
      expect(redactOutboxPayloadForAudit(payload)).toEqual({ ...payload });
    });
  });

  describe("given render diagnostics", () => {
    it("keeps them — they name variables, they do not carry values", () => {
      const payload: CadenceStagePayload = {
        ...makeCadence(),
        renderDiagnostics: { missingVariables: ["match.trace.metadata.user"] },
      };

      const redacted = redactOutboxPayloadForAudit(payload) as Record<
        string,
        unknown
      >;

      expect(redacted.renderDiagnostics).toEqual({
        missingVariables: ["match.trace.metadata.user"],
      });
    });
  });
});

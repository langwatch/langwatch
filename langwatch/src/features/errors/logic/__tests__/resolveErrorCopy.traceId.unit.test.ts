/**
 * When the error id is offered, and when it is withheld.
 *
 * The id is an escalation handle, not decoration: it is the one technical
 * detail a customer ever sees, and its only use is to be quoted to support
 * (ADR-045). A live UX pass found it under "This shared link isn't available"
 * on the anonymous share page and under "Invite not found or has expired" —
 * both fully explained, both the reader's own to resolve, and neither with
 * anything for support to look up. The dataset name clash offered one too,
 * beside a toast promising engineers had been paged over a duplicate name.
 *
 * Asserted through `resolveErrorCopy` rather than the components: the toast and
 * the inline alert both read `copy.traceId`, so the rule holds for both by
 * construction and cannot drift between them.
 */
import { describe, expect, it } from "vitest";

import { resolveErrorCopy } from "../resolveErrorCopy";

const TRACE_ID = "d2d07d1e4b70c2786e9139ee30a53e2a";

/** The tRPC envelope shape `readHandledError` parses. */
const wire = (error: Record<string, unknown>) => ({
  data: { error: { traceId: TRACE_ID, ...error } },
});

describe("resolveErrorCopy", () => {
  describe("given a named failure the customer can resolve alone", () => {
    /** @scenario "A named customer-fault failure offers no error id" */
    it("withholds the error id", () => {
      const copy = resolveErrorCopy({
        error: wire({
          code: "dataset_name_taken",
          httpStatus: 409,
          fault: "customer",
        }),
      });

      expect(copy.traceId).toBeUndefined();
      // The words are still there — withholding the id is not withholding help.
      expect(copy.title).toBe("That name is taken");
    });

    /**
     * The anonymous share page is the sharpest case: the reader has no account,
     * no ticket to open and no relationship with support.
     */
    it("withholds it on the public share page too", () => {
      const copy = resolveErrorCopy({
        error: wire({
          code: "share_link_not_found",
          httpStatus: 404,
          fault: "customer",
        }),
      });

      expect(copy.traceId).toBeUndefined();
    });
  });

  describe("given a failure on our side", () => {
    /** @scenario "A platform fault keeps its error id" */
    it("offers the error id for a platform fault", () => {
      const copy = resolveErrorCopy({
        error: wire({
          code: "workflow_execution_failed",
          httpStatus: 500,
          fault: "platform",
        }),
      });

      expect(copy.traceId).toBe(TRACE_ID);
    });

    it("offers the error id for a provider fault", () => {
      const copy = resolveErrorCopy({
        error: wire({
          code: "clickhouse_unavailable",
          httpStatus: 503,
          fault: "provider",
        }),
      });

      expect(copy.traceId).toBe(TRACE_ID);
    });
  });

  /**
   * A code with no registry entry degrades to the humanised slug, which tells
   * the reader nothing they can act on. The id is the only thing left.
   */
  describe("given a code the registry has no copy for", () => {
    /** @scenario "A failure with no copy for its code keeps its error id" */
    it("offers the error id", () => {
      const copy = resolveErrorCopy({
        error: wire({
          code: "something_we_have_not_written_copy_for",
          httpStatus: 400,
          fault: "customer",
        }),
      });

      expect(copy.traceId).toBe(TRACE_ID);
    });
  });

  describe("given a failure that was never handled", () => {
    /** @scenario "An unhandled failure keeps its error id" */
    it("offers the error id", () => {
      const copy = resolveErrorCopy({
        error: { data: { traceId: TRACE_ID, code: "INTERNAL_SERVER_ERROR" } },
        fallbackTitle: "Couldn't create the dataset",
      });

      expect(copy.traceId).toBe(TRACE_ID);
    });
  });
});

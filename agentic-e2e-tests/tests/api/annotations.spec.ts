import { test, expect } from "../support/fixtures";
import { listOf } from "../support/api";
import { expectMatchesContract } from "../support/contract";
import { ingestTrace, uniqueTraceId } from "../support/traces";

/**
 * Annotations over the public REST API.
 *
 * Annotations shipped with a UI, an API, a CLI and three MCP tools, and no
 * automated coverage at any level — which is how the envelope mismatch below
 * survived. Every route here answers `{ data: ... }`; consumers that assume a
 * bare array silently see nothing.
 *
 * Covers specs/annotations/annotations.feature.
 */

test.describe("Feature: annotations REST API", () => {
  test.describe("given a trace in the project", () => {
    test("a reviewer's annotation is attached to that trace", async ({ api }) => {
      const traceId = uniqueTraceId("annotate");
      await ingestTrace(api, { traceId });

      // Annotations attach by trace id and do not wait on the ingestion
      // pipeline, so there is no need to poll for the trace first.
      const created = await api.post<{ data: { id: string; comment: string } }>(
        `/api/annotations/trace/${traceId}`,
        { comment: "Looks wrong to me", isThumbsUp: false },
      );

      expect(created.data.id).toBeTruthy();
      expect(created.data.comment).toBe("Looks wrong to me");

      const listed = listOf<{ id: string }>(
        await api.get(`/api/annotations/trace/${traceId}`),
      );
      expect(listed.map((annotation) => annotation.id)).toContain(created.data.id);
    });

    test("an annotation can be edited and removed", async ({ api }) => {
      const traceId = uniqueTraceId("annotate-edit");
      await ingestTrace(api, { traceId });

      const created = await api.post<{ data: { id: string } }>(
        `/api/annotations/trace/${traceId}`,
        { comment: "First pass", isThumbsUp: true },
      );
      const id = created.data.id;

      const updated = await api.patch<{ data: { comment: string } }>(
        `/api/annotations/${id}`,
        { comment: "Second pass", isThumbsUp: false },
      );
      expect(updated.data.comment).toBe("Second pass");

      await api.delete(`/api/annotations/${id}`);

      const remaining = listOf<{ id: string }>(
        await api.get(`/api/annotations/trace/${traceId}`),
      );
      expect(remaining.map((annotation) => annotation.id)).not.toContain(id);
    });
  });

  test.describe("when the response shape is compared to its contract", () => {
    test("the annotations list still matches", async ({ api }) => {
      const traceId = uniqueTraceId("annotate-contract");
      await ingestTrace(api, { traceId });
      await api.post(`/api/annotations/trace/${traceId}`, {
        comment: "Contract fixture",
        isThumbsUp: true,
      });

      const payload = await api.get(`/api/annotations/trace/${traceId}`);

      // This is the assertion that would have caught the MCP tools being
      // broken: the envelope is `{ data: [...] }`, not a bare array, and a
      // consumer casting straight to an array sees nothing.
      expect(Array.isArray(payload)).toBe(false);
      expect(Array.isArray((payload as { data: unknown }).data)).toBe(true);

      expectMatchesContract("annotations-list", payload);
    });
  });
});

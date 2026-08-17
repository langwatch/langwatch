import { test, expect } from "../support/fixtures";
import { eventually, listOf } from "../support/api";
import { trpcMutation } from "../support/trpc";
import { ingestTrace, uniqueTraceId } from "../support/traces";

/**
 * Automations, end to end: author one, ingest a trace, assert the action ran.
 *
 * specs/automations/process-manager-dispatch.feature carries 20 scenarios of
 * asynchronous behaviour and every one of them is covered only by unit tests
 * with mocked queues — which assert our model of the queue, not the queue.
 * Nothing exercised author -> trace arrives -> action actually happened.
 *
 * `ADD_TO_DATASET` is the action worth testing here rather than a webhook:
 * webhook delivery is feature-flagged and its URL validator permits https on
 * port 443 only, so a local receiver is impossible by construction. Dataset
 * appends are creatable without a flag, are pinned to `immediate` cadence at
 * the storage boundary (persist actions never digest), and leave a row we can
 * read back — a deterministic side effect, which is what this tier requires.
 *
 * `traceDebounceMs: 0` skips the 30s trace-readiness settle. The field exists
 * for exactly this case: traces known to settle synchronously.
 */

type Dataset = { id: string; name: string };

/** The dataset read endpoint nests its records; tolerate either envelope. */
async function readRecords(
  api: { get<T>(path: string): Promise<T> },
  datasetId: string,
): Promise<Record<string, unknown>[]> {
  const payload = await api.get<unknown>(`/api/dataset/${datasetId}`);
  return listOf<Record<string, unknown>>(
    (payload as { data?: { records?: unknown } })?.data?.records ??
      (payload as { records?: unknown })?.records,
  );
}

async function createDataset(
  api: { post<T>(path: string, body: unknown): Promise<T> },
  name: string,
): Promise<Dataset> {
  return api.post<Dataset>("/api/dataset", {
    name,
    columnTypes: [
      { name: "input", type: "string" },
      { name: "output", type: "string" },
    ],
  });
}

// Dispatch crosses ingestion, projection and the process-manager queue, so
// these run well past the default per-test budget.
test.describe.configure({ timeout: 180_000 });

test.describe("Feature: automation dispatch", () => {
  test.describe("given an automation that appends matched traces to a dataset", () => {
    test("a trace that arrives is appended", async ({ api, tenant, request }) => {
      const dataset = await createDataset(
        api,
        `Automation target ${Date.now()}`,
      );

      await trpcMutation(request, "automation.upsert", {
        projectId: tenant.projectId,
        name: "Append everything",
        action: "ADD_TO_DATASET",
        filters: {},
        templates: {},
        traceDebounceMs: 0,
        actionParams: {
          datasetId: dataset.id,
          datasetMapping: {
            mapping: {
              input: { source: "input" },
              output: { source: "output" },
            },
            expansions: [],
          },
        },
      });

      const traceId = uniqueTraceId("automation");
      await ingestTrace(api, {
        traceId,
        input: "question for the automation",
        output: "answer for the automation",
      });

      const records = await eventually(
        `dataset ${dataset.id} to receive a record for trace ${traceId}`,
        async () => {
          const entries = await readRecords(api, dataset.id).catch(() => []);
          return entries.length > 0 ? entries : undefined;
        },
        { timeoutMs: 120_000, intervalMs: 2_000 },
      );

      expect(records.length).toBeGreaterThan(0);
    });
  });

  test.describe("when the automation is deactivated", () => {
    test("a trace that arrives afterwards is not appended", async ({
      api,
      tenant,
      request,
    }) => {
      const dataset = await createDataset(api, `Inactive target ${Date.now()}`);

      const created = await trpcMutation<{ id: string }>(
        request,
        "automation.upsert",
        {
          projectId: tenant.projectId,
          name: "Append while active",
          action: "ADD_TO_DATASET",
          filters: {},
          templates: {},
          traceDebounceMs: 0,
          actionParams: {
            datasetId: dataset.id,
            datasetMapping: {
              mapping: { input: { source: "input" } },
              expansions: [],
            },
          },
        },
      );

      // Positive control FIRST. Asserting an absence is worthless on its own —
      // it passes just as happily when dispatch is broken end to end as when
      // deactivation works, which is precisely how this test fooled us once.
      // Proving the automation fires while active is what gives the absence
      // below its meaning.
      await ingestTrace(api, {
        traceId: uniqueTraceId("automation-active"),
        input: "should be captured",
      });

      const afterActive = await eventually(
        "the active automation to append its first record",
        async () => {
          const entries = await readRecords(api, dataset.id);
          return entries.length > 0 ? entries : undefined;
        },
        { timeoutMs: 120_000, intervalMs: 2_000 },
      );
      const countWhileActive = afterActive.length;

      await api.patch(`/api/triggers/${created.id}`, { active: false });

      await ingestTrace(api, {
        traceId: uniqueTraceId("automation-inactive"),
        input: "should not be captured",
      });

      // No event marks "the automation definitely didn't fire", so this waits
      // out a window sized against the positive control above.
      await new Promise((resolve) => setTimeout(resolve, 30_000));

      const afterInactive = await readRecords(api, dataset.id);
      expect(afterInactive.length).toBe(countWhileActive);
    });
  });
});

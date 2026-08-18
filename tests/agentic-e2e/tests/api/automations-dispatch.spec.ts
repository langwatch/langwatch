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
 *
 * Each automation filters on a label unique to its own test. That is not
 * incidental: `automation.upsert` rejects a trace automation whose filters
 * narrow nothing (`TriggerFiltersRequiredError`), so `filters: {}` cannot be
 * saved at all — a match-everything automation is deliberately not creatable
 * through this API. Filtering on a per-test label satisfies that rule and
 * scopes dispatch to the trace this test ingested, which is what lets these
 * run alongside the rest of the headless tier.
 */

type Dataset = { id: string; name: string };

/**
 * Reads a dataset's rows.
 *
 * `GET /api/dataset/:id` answers `{ id, name, slug, ..., data: records }` — its
 * `data` IS the row array, so reaching for `data.records` on it yields
 * `undefined` and `listOf` then answers `[]` forever. Use the paginated records
 * endpoint, which answers `{ data, pagination }`, and hand the payload straight
 * to `listOf`.
 */
async function readRecords(
  api: { get<T>(path: string): Promise<T> },
  datasetId: string,
): Promise<Record<string, unknown>[]> {
  return listOf<Record<string, unknown>>(
    await api.get<unknown>(`/api/dataset/${datasetId}/records`),
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
// these run well past the default per-test budget. The deactivation test is
// what sets the floor: a 120s positive control, then a 30s settle window, on
// top of tenant provisioning and four HTTP round trips.
test.describe.configure({ timeout: 240_000 });

test.describe("Feature: automation dispatch", () => {
  test.describe("given an automation that appends matched traces to a dataset", () => {
    test("a trace that arrives is appended", async ({ api, tenant, request }) => {
      const dataset = await createDataset(
        api,
        `Automation target ${Date.now()}`,
      );
      const label = uniqueTraceId("label");

      await trpcMutation(request, "automation.upsert", {
        projectId: tenant.projectId,
        name: "Append labelled traces",
        action: "ADD_TO_DATASET",
        filters: { "metadata.labels": [label] },
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
        labels: [label],
        input: "question for the automation",
        output: "answer for the automation",
      });

      const records = await eventually(
        `dataset ${dataset.id} to receive a record for trace ${traceId}`,
        async () => {
          const entries = await readRecords(api, dataset.id);
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
      const label = uniqueTraceId("label");

      const created = await trpcMutation<{ id: string }>(
        request,
        "automation.upsert",
        {
          projectId: tenant.projectId,
          name: "Append while active",
          action: "ADD_TO_DATASET",
          filters: { "metadata.labels": [label] },
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
        labels: [label],
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

      // Same label as the trace that DID append. If this one is missing from
      // the dataset it is because the automation is off, not because it never
      // matched the filter.
      await ingestTrace(api, {
        traceId: uniqueTraceId("automation-inactive"),
        labels: [label],
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

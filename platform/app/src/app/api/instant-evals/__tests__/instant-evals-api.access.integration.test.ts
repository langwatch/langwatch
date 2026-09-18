/**
 * Stopping a run, and who may reach the family at all: a cancellation, a run
 * that already finished, a project without the flag, and a read-only key.
 *
 * The run service is stood up on fakes, so these exercise the request path the
 * framework builds without a ClickHouse, a queue or a classifier.
 *
 * @see ../[[...route]]/app.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstantEvalAlreadyFinishedError } from "~/server/app-layer/instant-evals/run/errors";
import { app } from "../[[...route]]/app";
import {
  BASE,
  type InstantEvalRunServiceFakes,
  SQL,
  setupInstantEvalsApiHarness,
} from "./instantEvalsApiHarness";

const flagIsOn = vi.hoisted(() => ({ value: true }));

vi.mock("~/server/app-layer/instant-evals/access", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("~/server/app-layer/instant-evals/access")
    >();
  return {
    ...original,
    instantEvalsEnabled: async () => flagIsOn.value,
  };
});

let keyAllows: (permission: string) => boolean = () => true;

const harness = setupInstantEvalsApiHarness({
  flag: flagIsOn,
  allows: (permission) => keyAllows(permission),
});

const { api, createUserKey, runRow } = harness;

let runs: InstantEvalRunServiceFakes;
let testProjectId: string;

beforeEach(() => {
  runs = harness.runs;
  testProjectId = harness.projectId;
  keyAllows = () => true;
});

describe("Feature: The Instant Eval run over REST", () => {
  describe("given a run in progress", () => {
    describe("when it is cancelled", () => {
      /** @scenario "A running run can be cancelled" */
      it("answers the run the cancellation was requested for", async () => {
        runs.cancel.mockResolvedValue(runRow({ status: "RUNNING" }));

        const res = await api.post(`${BASE}/instant_eval_abc/cancel`, {});
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("running");
        expect(runs.cancel).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: testProjectId,
            runId: "instant_eval_abc",
          }),
        );
      });
    });
  });

  describe("given a finished run that is asked to stop", () => {
    describe("when it is cancelled", () => {
      /** @scenario "A finished run cannot be cancelled" */
      it("answers 409 instant_eval_already_finished", async () => {
        runs.cancel.mockRejectedValue(
          new InstantEvalAlreadyFinishedError({
            runId: "instant_eval_abc",
            status: "FINISHED",
          }),
        );

        const res = await api.post(`${BASE}/instant_eval_abc/cancel`, {});
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.code).toBe("instant_eval_already_finished");
      });
    });
  });

  // ── access ─────────────────────────────────────────────────────────────────

  describe("given a project whose Instant Evals flag is off", () => {
    describe("when a run is requested", () => {
      /** @scenario "A project without the flag cannot reach the family" */
      it("answers 403 instant_eval_not_enabled and never reaches the service", async () => {
        flagIsOn.value = false;

        const res = await api.post(BASE, { sql: SQL });
        const body = await res.json();

        expect(res.status).toBe(403);
        expect(body.code).toBe("instant_eval_not_enabled");
        expect(runs.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a key carrying analytics:view only", () => {
    describe("when a run is requested and then listed", () => {
      /** @scenario "A read-only key cannot create or cancel a run" */
      it("refuses the create and the cancel, and lists runs", async () => {
        const { token } = await createUserKey();
        keyAllows = (permission) => permission === "analytics:view";
        runs.list.mockResolvedValue([]);
        const readOnly = { "X-Project-Id": testProjectId };
        const scopedHeaders = {
          "X-Auth-Token": token,
          "Content-Type": "application/json",
          ...readOnly,
        };

        const created = await app.request(BASE, {
          method: "POST",
          headers: scopedHeaders,
          body: JSON.stringify({ sql: SQL }),
        });
        const cancelled = await app.request(`${BASE}/instant_eval_abc/cancel`, {
          method: "POST",
          headers: scopedHeaders,
          body: "{}",
        });
        const listed = await app.request(BASE, { headers: scopedHeaders });

        expect(created.status).toBe(403);
        expect(cancelled.status).toBe(403);
        expect(listed.status).toBe(200);
        expect(runs.create).not.toHaveBeenCalled();
        expect(runs.cancel).not.toHaveBeenCalled();
      });
    });
  });
});

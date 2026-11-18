/**
 * The classifier breaker's transitions: when it stops sends, when it lets a probe through and
 * what closes it. Pure, no network.
 * @see modules/instant-eval/specs/classifier.feature
 */

import { describe, expect, it } from "vitest";

import {
  classifierBreakerAllowsSend,
  CLOSED_CLASSIFIER_BREAKER,
  INSTANT_EVAL_CLASSIFIER_BREAKER,
  recordClassifierSend,
  type ClassifierBreakerState,
  type ClassifierSendHealth,
} from "../instant-eval-classifier-breaker.rules.ts";

const { openAfterFailures, probeEveryMs } = INSTANT_EVAL_CLASSIFIER_BREAKER;

function after(
  healths: readonly ClassifierSendHealth[],
  from: ClassifierBreakerState = CLOSED_CLASSIFIER_BREAKER,
  now = 0,
): ClassifierBreakerState {
  return healths.reduce(
    (state, health) => recordClassifierSend({ state, health, now, probe: null }),
    from,
  );
}

const downs = (count: number): ClassifierSendHealth[] =>
  Array.from({ length: count }, () => "down");

const allows = (state: ClassifierBreakerState, now: number) =>
  classifierBreakerAllowsSend({ state, now }).isAllowed;

describe("the classifier breaker", () => {
  /** @scenario "One text failing on every attempt does not stop the others" */
  it("keeps sending below the threshold", () => {
    expect(allows(after(downs(openAfterFailures - 1)), 0)).toBe(true);
  });

  /** @scenario "A classifier failing on every send stops being sent to until a probe is answered" */
  it("stops sending at the threshold until the probe interval has passed", () => {
    const open = after(downs(openAfterFailures), CLOSED_CLASSIFIER_BREAKER, 1_000);

    expect(open.openedAt).toBe(1_000);
    expect(allows(open, 1_000)).toBe(false);
    expect(allows(open, 1_000 + probeEveryMs - 1)).toBe(false);
  });

  /** @scenario "A classifier failing on every send stops being sent to until a probe is answered" */
  it("lets exactly one probe through once the interval has passed", () => {
    const open = after(downs(openAfterFailures));
    const probe = classifierBreakerAllowsSend({ state: open, now: probeEveryMs });

    expect(probe.isAllowed).toBe(true);
    expect(allows(probe.state, probeEveryMs * 5)).toBe(false);
  });

  /** @scenario "An answered probe lets every text be sent again" */
  it("closes when the probe is answered", () => {
    const probe = classifierBreakerAllowsSend({
      state: after(downs(openAfterFailures)),
      now: probeEveryMs,
    });
    const closed = recordClassifierSend({
      state: probe.state,
      health: "up",
      now: probeEveryMs,
      probe: probe.probe,
    });

    expect(closed).toEqual({ ...CLOSED_CLASSIFIER_BREAKER, probesSent: 1 });
    expect(allows(closed, probeEveryMs)).toBe(true);
  });

  /** @scenario "A classifier failing on every send stops being sent to until a probe is answered" */
  it("waits a fresh interval after a failed probe", () => {
    const probe = classifierBreakerAllowsSend({
      state: after(downs(openAfterFailures)),
      now: probeEveryMs,
    });
    const reopened = recordClassifierSend({
      state: probe.state,
      health: "down",
      now: 12_000,
      probe: probe.probe,
    });

    expect(allows(reopened, 12_000 + probeEveryMs - 1)).toBe(false);
    expect(allows(reopened, 12_000 + probeEveryMs)).toBe(true);
  });

  /** @scenario "A cancelled probe does not stop the next one" */
  it("frees the probe when its own send comes back neutral", () => {
    const probe = classifierBreakerAllowsSend({
      state: after(downs(openAfterFailures)),
      now: probeEveryMs,
    });
    const freed = recordClassifierSend({
      state: probe.state,
      health: "neutral",
      now: probeEveryMs,
      probe: probe.probe,
    });

    expect(freed.probeInFlight).toBeNull();
    expect(allows(freed, probeEveryMs * 2)).toBe(true);
  });

  /** @scenario "A cancelled probe does not stop the next one" */
  it("keeps the probe reserved when an older send comes back", () => {
    const probe = classifierBreakerAllowsSend({
      state: after(downs(openAfterFailures)),
      now: probeEveryMs,
    });
    const older = after(["neutral", "down"], probe.state, probeEveryMs);

    expect(older.probeInFlight).toBe(probe.probe);
    expect(allows(older, probeEveryMs * 5)).toBe(false);
  });

  /** @scenario "Rate limits and permanent refusals never stop sends" */
  it("neither opens nor resets on rate limits and permanent refusals", () => {
    expect(allows(after(Array.from({ length: 100 }, () => "neutral")), 0)).toBe(true);
    expect(after([...downs(openAfterFailures - 1), "neutral"]).consecutiveFailures).toBe(
      openAfterFailures - 1,
    );
  });

  /** @scenario "One text failing on every attempt does not stop the others" */
  it("starts counting again after an answer", () => {
    const state = after([...downs(openAfterFailures - 1), "up", ...downs(openAfterFailures - 1)]);

    expect(allows(state, 0)).toBe(true);
  });
});

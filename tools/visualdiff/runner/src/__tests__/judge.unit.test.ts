import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { judgeFor, PairJudge, type Judge, type Regression } from "../judge.ts";
import type { Plan } from "../protocol.ts";

const missing: Regression = {
  kind: "missing-element",
  element: 'button "Save"',
  message: "save is gone",
};
const error: Regression = { kind: "error-text", element: 'alert "Failed"', message: "toast" };

/** fakeJudge answers the scripted verdicts in turn and counts how often it was asked. */
const fakeJudge = (answers: Regression[][]): Judge & { calls: number } => {
  const judge = Object.assign(
    async () => {
      const regressions = answers[judge.calls] ?? [];
      judge.calls += 1;
      return { regressions, inputTokens: 1000, outputTokens: 200 };
    },
    { calls: 0 },
  );
  return judge;
};

const cacheFile = (): string => join(mkdtempSync(join(tmpdir(), "vd-judge-")), "cache.json");
const pair = (bytes: string, ratio = 0.3) => ({
  label: "flow_alerts_2",
  ratio,
  base: Buffer.from(`main ${bytes}`),
  candidate: Buffer.from(`branch ${bytes}`),
});

describe("Feature: visualdiff judge keeps only agreed regressions", () => {
  /** @scenario "A plan without a judge never asks the model" */
  it("leaves the judge off when the plan does not set it", () => {
    const plan: Plan = JSON.parse('{"routes":[],"flows":[]}');
    expect(judgeFor({ plan, key: { apiKey: "" } })).toBeUndefined();
    const asked: Plan = { ...plan, judge: { cacheFile: cacheFile() } };
    expect(() => judgeFor({ plan: asked, key: { apiKey: "" } })).toThrow(/ANTHROPIC_API_KEY/);
  });

  /** @scenario "A pair the pixel diff did not flag is skipped" */
  it("does not ask about a pair under the noise ratio", async () => {
    const judge = fakeJudge([[missing]]);
    const regressions = await new PairJudge(judge, cacheFile()).check(pair("a", 0.01));
    expect(regressions).toEqual([]);
    expect(judge.calls).toBe(0);
  });

  /** @scenario "A regression the second judgement does not repeat is dropped" */
  it("keeps only what both judgements name", async () => {
    const judge = fakeJudge([[missing, error], [{ ...missing, message: "reworded" }]]);
    const regressions = await new PairJudge(judge, cacheFile()).check(pair("a"));
    expect(regressions).toEqual([missing]);
    expect(judge.calls).toBe(2);
  });

  /** @scenario "A harmless difference is judged once" */
  it("asks once when the first judgement names nothing", async () => {
    const judge = fakeJudge([[]]);
    expect(await new PairJudge(judge, cacheFile()).check(pair("a"))).toEqual([]);
    expect(judge.calls).toBe(1);
  });

  /** @scenario "The same screenshot pair is not judged again in a later run" */
  it("answers a later run from the cache file by pair hash", async () => {
    const file = cacheFile();
    const first = new PairJudge(fakeJudge([[missing], [missing]]), file);
    await first.check(pair("a"));
    first.save(join(file, "..", "judge.json"));
    const judge = fakeJudge([]);
    const later = new PairJudge(judge, file);
    expect(await later.check(pair("a"))).toEqual([missing]);
    expect(judge.calls).toBe(0);
    expect(later.ledger().cached).toBe(1);
    await later.check(pair("b"));
    expect(judge.calls).toBe(1);
  });

  /** @scenario "The ledger counts calls, tokens and dollars" */
  it("records both calls, their tokens and their cost", async () => {
    const check = new PairJudge(fakeJudge([[missing], [missing]]), cacheFile());
    await check.check(pair("a"));
    const ledger = check.ledger();
    expect(ledger).toMatchObject({ calls: 2, inputTokens: 2000, outputTokens: 400 });
    expect(ledger.usd).toBeCloseTo(2000 * 0.1e-6 + 400 * 0.5e-6);
    expect(ledger.pairs[0]).toMatchObject({ label: "flow_alerts_2", calls: 2 });
  });

  /** @scenario "A judge that fails keeps no verdict and is counted" */
  it("files nothing, caches nothing and counts the failure", async () => {
    const file = cacheFile();
    const failing: Judge = async () => {
      throw new Error("Haiku answered 401: unauthorised");
    };
    const check = new PairJudge(failing, file);
    expect(await check.check(pair("a"))).toEqual([]);
    expect(check.ledger()).toMatchObject({
      failures: 1,
      firstFailure: "Haiku answered 401: unauthorised",
    });
    check.save(join(file, "..", "judge.json"));
    const judge = fakeJudge([[]]);
    await new PairJudge(judge, file).check(pair("a"));
    expect(judge.calls).toBe(1);
  });
});

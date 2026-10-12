import { describe, expect, it } from "vitest";

import { planSchema } from "../protocol.ts";
import { signatureOf } from "../report.ts";
import { visionDraft, VisionCheck, type Judge, type VisionVerdict } from "../vision.ts";

const ROUTE = "/:project/messages";
const spinner = (message: string): VisionVerdict => ({
  kind: "stuck-loading",
  element: 'region "Messages"',
  message,
});
const toast: VisionVerdict = { kind: "error-shown", element: 'alert "Failed"', message: "toast" };

/** fakeJudge answers the scripted verdicts in turn and counts how often it was asked. */
const fakeJudge = (answers: VisionVerdict[][]): Judge & { calls: number } => {
  const judge = Object.assign(
    async () => {
      const findings = answers[judge.calls] ?? [];
      judge.calls += 1;
      return { findings, inputTokens: 1000, outputTokens: 200 };
    },
    { calls: 0 },
  );
  return judge;
};

const page = (bytes: string) => ({ route: ROUTE, image: Buffer.from(bytes), aria: "" });

describe("vision", () => {
  /** @scenario A plan without vision never asks the judge */
  it("is off unless the plan asks for it", () => {
    const plan = planSchema.parse({
      url: "https://app.test",
      credential: { email: "", password: "" },
    });
    expect(plan.vision).toBe(false);
  });

  /** @scenario Two wordings of one defect on one element share a signature */
  it("signs by route, kind and element, never the message", () => {
    const one = signatureOf(visionDraft({ route: ROUTE, verdict: spinner("spinner never stops") }));
    const two = signatureOf(visionDraft({ route: ROUTE, verdict: spinner("Loading forever 3s") }));
    expect(one).toBe(two);
    expect(one).toBe("vision :: /[project]/messages stuck-loading region messages");
  });

  /** @scenario The same screenshot of a route is not judged twice */
  it("judges a route again only when its screenshot changes", async () => {
    const judge = fakeJudge([]);
    const vision = new VisionCheck(judge);
    await vision.check(page("a"));
    await vision.check(page("a"));
    expect(judge.calls).toBe(1);
    await vision.check(page("b"));
    expect(judge.calls).toBe(2);
  });

  /** @scenario A finding the second judgement does not repeat is dropped */
  it("keeps only what both judgements name", async () => {
    const vision = new VisionCheck(fakeJudge([[spinner("x"), toast], [spinner("y")]]));
    const drafts = await vision.check(page("a"));
    expect(drafts.map((draft) => draft.signature)).toEqual([
      "vision /[project]/messages stuck-loading region messages",
    ]);
  });

  /** @scenario A clean page is judged once */
  it("asks once when the first judgement is clean", async () => {
    const judge = fakeJudge([[]]);
    expect(await new VisionCheck(judge).check(page("a"))).toEqual([]);
    expect(judge.calls).toBe(1);
  });

  /** @scenario The cost ledger counts calls, tokens and dollars per page */
  it("records each page's calls, tokens and cost", async () => {
    const vision = new VisionCheck(fakeJudge([[toast], [toast]]));
    await vision.check(page("a"));
    const ledger = vision.ledger();
    expect(ledger).toMatchObject({ calls: 2, inputTokens: 2000, outputTokens: 400, failures: 0 });
    expect(ledger.pages).toEqual([
      expect.objectContaining({ route: ROUTE, calls: 2, findings: 1 }),
    ]);
    expect(ledger.usd).toBeCloseTo(2000 * 0.1e-6 + 400 * 0.5e-6);
    expect(ledger.perPageUsd).toBe(ledger.usd);
  });

  /** @scenario A judge that fails files no finding and is counted */
  it("counts a failed judgement and files nothing", async () => {
    const vision = new VisionCheck(async () => {
      throw new Error("Haiku answered 401: invalid x-api-key");
    });
    expect(await vision.check(page("a"))).toEqual([]);
    expect(vision.ledger()).toMatchObject({
      failures: 1,
      firstFailure: "Haiku answered 401: invalid x-api-key",
    });
  });
});

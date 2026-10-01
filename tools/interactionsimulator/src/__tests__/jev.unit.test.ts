import { describe, expect, it } from "vitest";

import { chooseStep, flagOf, type StepAnswer } from "../jev.ts";
import { Ledger } from "../ledger.ts";
import { candidatesOf } from "../page.ts";

const ARIA = `- navigation:
  - link "Datasets"
- main:
  - button "New dataset"
- dialog "Create dataset":
  - textbox "Name"
  - button "Save"
  - button "Save"`;

/** fakeJev answers every request with `answers`, and keeps each request it was sent. */
const fakeJev = (answers: Record<string, unknown>) => {
  const requests: {
    url: string;
    authorization: string;
    body: {
      state: string;
      model: string;
      questions: Record<string, { type: string; criteria?: Record<string, string> }>;
    };
  }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      url: input instanceof Request ? input.url : input.toString(),
      authorization: new Headers(init?.headers).get("authorization") ?? "",
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
    });
    return Response.json({ answers, usage: { input_tokens: 1200 } });
  };
  return { requests, config: { baseUrl: "https://jev.example", apiKey: "key", fetchImpl } };
};

const ask = async (
  jev: ReturnType<typeof fakeJev>,
  values: Record<string, string> = { name: "Sim {uid}" },
) => {
  const ledger = new Ledger();
  const answer = await chooseStep({
    config: jev.config,
    ledger,
    goal: "Create a dataset",
    steps: ["Name it", "Save"],
    values,
    history: [],
    url: "/p/datasets",
    page: ARIA,
    candidates: candidatesOf({ aria: ARIA }),
  });
  return { answer, ledger };
};

describe("chooseStep", () => {
  describe("given a dialog is open", () => {
    it("offers jev only the dialog's controls, each once, beside done and stuck", async () => {
      const jev = fakeJev({ element: { choice: "e1" } });
      await ask(jev);
      const [request] = jev.requests;
      expect(request?.url).toBe("https://jev.example/v1/systemone");
      expect(request?.authorization).toBe("Bearer key");
      expect(request?.body.model).toBe("jev-latest");
      expect(request?.body.questions.element?.criteria).toEqual({
        e1: 'textbox "Name"',
        e2: 'button "Save"',
        done: expect.any(String),
        stuck: expect.any(String),
      });
      expect(request?.body.questions.error_shown?.type).toBe("noul");
    });
  });

  describe("when jev answers with probabilities and no choice", () => {
    it("takes the likeliest option and counts the call", async () => {
      const jev = fakeJev({
        error_shown: { noul: 0.1 },
        progressed: { noul: 0.9 },
        stuck: { noul: 0.05 },
        element: { probabilities: { e1: 0.2, e2: 0.7 } },
        action: { choice: "click" },
        value: { choice: "name" },
      });
      const { answer, ledger } = await ask(jev);
      expect(answer).toEqual({
        errorShown: 0.1,
        progressed: 0.9,
        stuck: 0.05,
        element: "e2",
        action: "click",
        value: "name",
      });
      expect(ledger.jev).toMatchObject({ calls: 1, inputTokens: 1200 });
      expect(ledger.saved.sonnetInputTokens).toBe(1200);
    });
  });

  describe("when the journey plans no values", () => {
    it("asks no value question", async () => {
      const jev = fakeJev({});
      await ask(jev, {});
      expect(jev.requests[0]?.body.questions.value).toBeUndefined();
    });
  });

  describe("when jev refuses the request", () => {
    it("throws with its status", async () => {
      const failing: typeof fetch = async () => new Response("no", { status: 401 });
      await expect(
        chooseStep({
          config: { baseUrl: "https://jev.example", apiKey: "bad", fetchImpl: failing },
          ledger: new Ledger(),
          goal: "g",
          steps: ["s"],
          values: {},
          history: [],
          url: "/",
          page: "",
          candidates: [],
        }),
      ).rejects.toThrow(/jev answered 401/);
    });
  });
});

describe("flagOf", () => {
  const calm: StepAnswer = {
    errorShown: 0.1,
    progressed: 0.9,
    stuck: 0.1,
    element: "e1",
    action: "click",
    value: "",
  };

  it("lets a calm step through", () => {
    expect(flagOf({ answer: calm, isFirst: false })).toBe("");
  });

  it("flags a shown error", () => {
    expect(flagOf({ answer: { ...calm, errorShown: 0.8 }, isFirst: false })).toMatch(/error/);
  });

  it("flags a step that took no effect, but not the first", () => {
    const still = { ...calm, progressed: 0.2 };
    expect(flagOf({ answer: still, isFirst: false })).toMatch(/no effect/);
    expect(flagOf({ answer: still, isFirst: true })).toBe("");
  });
});

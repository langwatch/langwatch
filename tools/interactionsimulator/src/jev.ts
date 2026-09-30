import { z } from "zod";

import type { Ledger } from "./ledger";
import type { Candidate } from "./page";

/** jev's path and default model, as modules/instant-eval's HTTP judge addresses it. */
const JEV_PATH = "/v1/systemone";
const JEV_DEFAULT_MODEL = "jev-latest";

/** A yes/no probability past this flags the step; "progressed" flags below its inverse. */
const FLAG_THRESHOLD = 0.5;

const answerSchema = z.object({
  noul: z.number().optional(),
  choice: z.string().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

const responseSchema = z.object({
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ input_tokens: z.number().optional() }).optional(),
});

type JevAnswer = z.infer<typeof answerSchema>;

type JevQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export interface JevConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/** askJev asks every question about one text in one request and reads the answers by id. */
const askJev = async ({
  config,
  ledger,
  state,
  questions,
}: {
  config: JevConfig;
  ledger: Ledger;
  state: string;
  questions: Record<string, JevQuestion>;
}): Promise<Record<string, JevAnswer>> => {
  const response = await (config.fetchImpl ?? fetch)(new URL(JEV_PATH, config.baseUrl).toString(), {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ state, model: config.model ?? JEV_DEFAULT_MODEL, questions }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`jev answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const parsed = responseSchema.parse(await response.json());
  ledger.jevCall({ inputTokens: parsed.usage?.input_tokens ?? Math.ceil(state.length / 4) });
  return parsed.answers;
};

const chosen = (answer: JevAnswer | undefined): string => {
  if (answer?.choice !== undefined) return answer.choice;
  const ranked = Object.entries(answer?.probabilities ?? {}).toSorted(([, a], [, b]) => b - a);
  return ranked[0]?.[0] ?? "";
};

/** StepAnswer is one jev call: the page the last action left, and the next action on it. */
export interface StepAnswer {
  errorShown: number;
  progressed: number;
  stuck: number;
  /** element is a candidate id, "done" once the goal is reached, or "stuck". */
  element: string;
  action: string;
  /** value is the name of one planned value, or "". */
  value: string;
}

/**
 * chooseStep asks jev about the page as it stands: whether the last action
 * showed an error, took effect or left the user stuck, and which element,
 * action and planned value come next. One call judges one step and picks the next.
 */
export const chooseStep = async ({
  config,
  ledger,
  goal,
  steps,
  values,
  history,
  url,
  page,
  candidates,
}: {
  config: JevConfig;
  ledger: Ledger;
  goal: string;
  steps: string[];
  values: Record<string, string>;
  history: string[];
  url: string;
  page: string;
  candidates: Candidate[];
}): Promise<StepAnswer> => {
  const elements: Record<string, string> = Object.fromEntries(
    candidates.map((candidate) => [candidate.id, `${candidate.role} "${candidate.name}"`]),
  );
  elements.done = "nothing: the goal is already reached on this page";
  elements.stuck = "nothing: no element on this page leads toward the goal";
  const questions: Record<string, JevQuestion> = {
    error_shown: {
      type: "noul",
      instructions:
        "Does the page show an error: an error message or toast, a crash screen, 'something went wrong'?",
    },
    progressed: {
      type: "noul",
      instructions:
        "Did the last action take effect: a dialog opened or closed, something saved or appeared, the page moved on?",
    },
    stuck: {
      type: "noul",
      instructions:
        "Is the user stuck: a blocking dialog, a disabled form, an empty or endlessly loading page?",
    },
    element: {
      type: "choice",
      instructions:
        "Which element should the user use next to reach the goal, following the planned steps?",
      criteria: elements,
    },
    action: {
      type: "choice",
      instructions: "What should the user do with that element?",
      criteria: {
        click: "press, open or toggle it",
        fill: "type text into it",
        select: "pick one of its options",
      },
    },
  };
  if (Object.keys(values).length > 0) {
    questions.value = {
      type: "choice",
      instructions: "If the user types or picks something there, which planned value is it?",
      criteria: values,
    };
  }
  const state = [
    `Goal: ${goal}`,
    `Planned steps:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
    `Done so far:\n${history.join("\n") || "nothing yet"}`,
    `Page ${url}:`,
    page,
  ].join("\n\n");
  const answers = await askJev({ config, ledger, state, questions });
  return {
    errorShown: answers.error_shown?.noul ?? 0,
    progressed: answers.progressed?.noul ?? 1,
    stuck: answers.stuck?.noul ?? 0,
    element: chosen(answers.element),
    action: chosen(answers.action),
    value: chosen(answers.value),
  };
};

/** flagOf names why jev's reading of the page sends the journey back to Sonnet, or "". */
export const flagOf = ({ answer, isFirst }: { answer: StepAnswer; isFirst: boolean }): string => {
  if (answer.errorShown > FLAG_THRESHOLD)
    return `an error is shown (${answer.errorShown.toFixed(2)})`;
  if (answer.stuck > FLAG_THRESHOLD || answer.element === "stuck") return "the user is stuck";
  if (!isFirst && answer.progressed < 1 - FLAG_THRESHOLD) {
    return `the last action took no effect (${answer.progressed.toFixed(2)})`;
  }
  return "";
};

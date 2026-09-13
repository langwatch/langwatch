/**
 * The `question` tool: Langy asks the user mid-turn and keeps the turn.
 *
 * The tool posts the question as a user wait, then long-polls it. The app
 * writes the durable event and the live entry the panel renders as a choices
 * card (ADR-060 §6). The answer comes back as the tool result, so Langy
 * continues the same turn with the plan it had.
 */

import { Type } from "typebox";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  AppUnreachableError,
  callApp,
  CallCancelledError,
  CANCELLED_PUSHBACK,
} from "./local-workspace.js";
import { callIds, type TurnContext } from "./turn-context.js";

export const QUESTION_TOOL_NAME = "question";

/** How long one long poll may take. */
const POLL_REQUEST_TIMEOUT_MS = 40_000;

/** How long a plain request may take. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Wait this long after a failed poll before the next one. */
const POLL_RETRY_DELAY_MS = 1_000;

/** Give up after this many failed polls in a row. */
const MAX_POLL_FAILURES = 3;

/**
 * The longest the tool waits for an answer.
 *
 * It is the app's own question budget (`QUESTION_WAIT_BUDGET_MS` in
 * `platform/app/src/server/langy-local-control/constants.ts`). The app expires
 * the card and answers `expired` first; this is the net under it, so a worker
 * that cannot reach the app still ends its turn at the same minute the card
 * on screen stops waiting.
 */
export const WAIT_MAX_MS = 10 * 60 * 1000;

/** What the model reads when the wait passes its budget. */
export const NO_ANSWER_PUSHBACK =
  "No answer yet. End your turn and say in one line what you need from the user; their answer arrives as the next message.";

/** What the model reads when the app does not answer at all. */
export const QUESTION_UNAVAILABLE_PUSHBACK =
  "The question could not be shown. Ask the user in words at the end of your turn.";

export type QuestionAnswer = {
  question: string;
  selected: string[];
  other?: string;
};

type PollWaitResponse = {
  waitId: string;
  state: "pending" | "answered" | "expired" | "cancelled";
  answers?: QuestionAnswer[];
};

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** The answers as the model reads them. */
export function renderAnswers(answers: QuestionAnswer[]): string {
  if (answers.length === 0) return NO_ANSWER_PUSHBACK;
  return answers
    .map((answer) => {
      const parts: string[] = [];
      if (answer.selected.length > 0) parts.push(answer.selected.join(", "));
      if (answer.other) parts.push(`in their own words: ${answer.other}`);
      return `Q: ${answer.question}\nA: ${parts.length > 0 ? parts.join("; ") : "no option picked"}`;
    })
    .join("\n\n");
}

export async function askQuestions({
  questions,
  turnContext,
  toolCallId,
  signal,
  now = () => Date.now(),
}: {
  questions: unknown;
  turnContext: TurnContext;
  toolCallId?: string;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<string> {
  const startedAt = now();
  const started = await callApp<{ waitId: string }>({
    path: "/api/langy/waits",
    method: "POST",
    body: {
      ...callIds({ turnContext, ...(toolCallId ? { toolCallId } : {}) }),
      kind: "question",
      questions,
    },
    signal,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  let failures = 0;
  for (;;) {
    if (signal?.aborted) throw new CallCancelledError(CANCELLED_PUSHBACK);
    if (now() - startedAt > WAIT_MAX_MS) return NO_ANSWER_PUSHBACK;

    let poll: PollWaitResponse;
    try {
      poll = await callApp<PollWaitResponse>({
        path: `/api/langy/waits/${encodeURIComponent(started.waitId)}`,
        method: "GET",
        signal,
        timeoutMs: POLL_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof CallCancelledError || signal?.aborted) {
        throw new CallCancelledError(CANCELLED_PUSHBACK);
      }
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) throw error;
      await sleep(POLL_RETRY_DELAY_MS, signal);
      continue;
    }
    failures = 0;

    if (poll.state === "pending") continue;
    if (poll.state === "answered") return renderAnswers(poll.answers ?? []);
    if (poll.state === "cancelled") throw new CallCancelledError(CANCELLED_PUSHBACK);
    return NO_ANSWER_PUSHBACK;
  }
}

const questionParams = Type.Object({
  questions: Type.Array(
    Type.Object({
      question: Type.String({ description: "The question, in the user's words." }),
      header: Type.Optional(
        Type.String({ description: "A short title for the card, up to 60 characters." }),
      ),
      options: Type.Array(
        Type.Object({
          label: Type.String({ description: "The answer, short enough to read on a button." }),
          description: Type.Optional(
            Type.String({ description: "One line about what this answer means." }),
          ),
        }),
        { description: "One to eight options. The options are the answers." },
      ),
      multiple: Type.Optional(
        Type.Boolean({ description: "Let the user pick more than one option." }),
      ),
      allowOther: Type.Optional(
        Type.Boolean({ description: "Let the user write their own answer." }),
      ),
    }),
    { description: "One to four questions. Ask one question at a time when you can." },
  ),
});

export function createQuestionExtension({
  turnContext,
}: {
  turnContext: TurnContext;
}): InlineExtension {
  return {
    name: "langy-question",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool({
        name: QUESTION_TOOL_NAME,
        label: "Question",
        description:
          "Ask the user a question and wait for the answer. Decide routine things alone. Ask only when two ways forward differ for the user, for example which file owns the setup, which account to use, or whether to open the pull request now. Ask one question at a time. The options are the answers, so write them as answers, not as more questions.",
        parameters: questionParams,
        async execute(toolCallId, params, signal) {
          try {
            const text = await askQuestions({
              questions: params.questions,
              turnContext,
              toolCallId,
              signal,
            });
            return { content: [{ type: "text" as const, text }], details: {} };
          } catch (error) {
            if (error instanceof AppUnreachableError) {
              return {
                content: [
                  { type: "text" as const, text: QUESTION_UNAVAILABLE_PUSHBACK },
                ],
                details: {},
              };
            }
            throw error;
          }
        },
      });
    },
  };
}

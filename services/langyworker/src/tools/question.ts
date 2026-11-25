/**
 * The `question` tool: Langy asks the user mid-turn and keeps the turn. It
 * posts the question as a user wait, then long-polls it; the answer comes
 * back as the tool result (ADR-060 §6).
 */

import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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
 * The longest the tool waits for an answer: the app's own question budget.
 * The app expires the card first; this is the net under it, so a worker
 * that cannot reach the app still ends its turn on the same minute.
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
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(settle, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        settle();
      },
      { once: true },
    );
  });
}

/**
 * What the model reads after the answers, so the go is in the tool result
 * itself, whichever skill asked: a reply that only speaks after an answer
 * ends the turn with the work undone.
 */
export const ANSWERED_CONTINUE_LINE =
  "The user has answered. Continue with the work that follows this answer in this turn.";

/**
 * A line as it is compared to an option label: the list marker, the quotes
 * around it and the punctuation after it off, whitespace and case folded.
 */
function foldLabel(text: string): string {
  return text
    .trim()
    .replace(/^(?:\d+[.)]|[-*•])\s+/, "")
    .replace(/^["'“”‘’]+|["'“”‘’.!?:;,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The question text without the option labels written out at its end,
 * since the card already draws them as buttons. Labels mid-text are left
 * alone, and so is a text that is nothing but the labels.
 */
export function dropRepeatedOptions(question: string, labels: readonly string[]): string {
  const folded = new Set(labels.map(foldLabel).filter((label) => label.length > 0));
  if (folded.size === 0) return question;
  const lines = question.split("\n");
  let matched = 0;
  let cut = lines.length;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = (lines[index] ?? "").trim();
    if (line === "") continue;
    if (!folded.has(foldLabel(line))) break;
    matched += 1;
    cut = index;
  }
  if (matched === 0) return question;
  const kept = lines.slice(0, cut);
  const dropTrailingBlanks = () => {
    while (kept.length > 0 && (kept[kept.length - 1] ?? "").trim() === "") kept.pop();
  };
  dropTrailingBlanks();
  if (/:\s*$/.test(kept[kept.length - 1] ?? "")) kept.pop();
  dropTrailingBlanks();
  const text = kept.join("\n");
  return text.trim() === "" ? question : text;
}

/** The questions as the card gets them: each text without its options repeated at the end. */
export function withoutRepeatedOptions(questions: unknown): unknown {
  if (!Array.isArray(questions)) return questions;
  return questions.map((entry) => {
    if (typeof entry !== "object" || entry === null) return entry;
    const { question, options } = entry as { question?: unknown; options?: unknown };
    if (typeof question !== "string" || !Array.isArray(options)) return entry;
    const labels = options
      .map((option) =>
        typeof option === "object" && option !== null
          ? (option as { label?: unknown }).label
          : undefined,
      )
      .filter((label): label is string => typeof label === "string");
    return { ...entry, question: dropRepeatedOptions(question, labels) };
  });
}

/** The answers as the model reads them. */
export function renderAnswers(answers: QuestionAnswer[]): string {
  if (answers.length === 0) return NO_ANSWER_PUSHBACK;
  const rendered = answers
    .map((answer) => {
      const parts: string[] = [];
      if (answer.selected.length > 0) parts.push(answer.selected.join(", "));
      if (answer.other) parts.push(`in their own words: ${answer.other}`);
      return `Q: ${answer.question}\nA: ${parts.length > 0 ? parts.join("; ") : "no option picked"}`;
    })
    .join("\n\n");
  return `${rendered}\n\n${ANSWERED_CONTINUE_LINE}`;
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
      questions: withoutRepeatedOptions(questions),
    },
    signal,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  return waitForAnswer({ waitId: started.waitId, startedAt, signal, now });
}

/** One poll of a wait, retried on failure up to MAX_POLL_FAILURES, until it settles. */
async function pollOnce({
  waitId,
  signal,
  failures,
}: {
  waitId: string;
  signal: AbortSignal | undefined;
  failures: number;
}): Promise<{ poll?: PollWaitResponse; failures: number }> {
  try {
    const poll = await callApp<PollWaitResponse>({
      path: `/api/langy/waits/${encodeURIComponent(waitId)}`,
      method: "GET",
      signal,
      timeoutMs: POLL_REQUEST_TIMEOUT_MS,
    });
    return { poll, failures: 0 };
  } catch (error) {
    if (error instanceof CallCancelledError || signal?.aborted) {
      throw new CallCancelledError(CANCELLED_PUSHBACK);
    }
    const nextFailures = failures + 1;
    if (nextFailures >= MAX_POLL_FAILURES) throw error;
    await sleep(POLL_RETRY_DELAY_MS, signal);
    return { failures: nextFailures };
  }
}

/** Polls a wait until it answers, expires, is cancelled, or the tool's own budget runs out. */
async function waitForAnswer({
  waitId,
  startedAt,
  signal,
  now,
}: {
  waitId: string;
  startedAt: number;
  signal: AbortSignal | undefined;
  now: () => number;
}): Promise<string> {
  let failures = 0;
  for (;;) {
    if (signal?.aborted) throw new CallCancelledError(CANCELLED_PUSHBACK);
    if (now() - startedAt > WAIT_MAX_MS) return NO_ANSWER_PUSHBACK;

    const result = await pollOnce({ waitId, signal, failures });
    failures = result.failures;
    if (!result.poll) continue;

    if (result.poll.state === "pending") continue;
    if (result.poll.state === "answered") return renderAnswers(result.poll.answers ?? []);
    if (result.poll.state === "cancelled") throw new CallCancelledError(CANCELLED_PUSHBACK);
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
          quiet: Type.Optional(
            Type.Boolean({
              description:
                "Show this answer as a quiet link under the main options, for the way out rather than the way forward. It is still a real answer.",
            }),
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
      bare: Type.Optional(
        Type.Boolean({
          description:
            "Draw the question field as ordinary reply prose (markdown) above the options, with no title and no frame. Use it when the question is the whole of what you have to say, so put every word of it in the question field and say nothing before the call.",
        }),
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
                content: [{ type: "text" as const, text: QUESTION_UNAVAILABLE_PUSHBACK }],
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

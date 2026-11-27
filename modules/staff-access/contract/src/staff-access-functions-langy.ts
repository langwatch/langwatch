/**
 * The langy ops functions (ADR-202): Langy turns as ids, states, failure codes, counts and times.
 * No message, command, tool argument, tool result or error text.
 * Spec: modules/staff-access/specs/staff-access-functions-langy.feature
 */
import { z } from "zod";

import {
  countsByCode,
  entry,
  isoTime,
  pageInput,
  rangeInput,
  staffAccessPageSchema,
  type StaffAccessFunctionEntry,
} from "./staff-access-function-shapes.ts";

const toolCallShape = z
  .object({
    /** `langwatch.<cli group>` for a LangWatch CLI call, else the tool's name. */
    tool: z.string(),
    status: z.string(),
    durationMs: z.number().nullable(),
    /** `permission` or `question` when the call put a card in front of the person. */
    waitKind: z.string().nullable(),
    targetKind: z.string().nullable(),
    targetId: z.string().nullable(),
  })
  .strict();

export const STAFF_ACCESS_LANGY_FUNCTIONS = {
  "org.langy": entry({
    title: "Langy turns per day, model, state and failure code",
    scope: "org",
    answers:
      "Whether Langy fails for an organization: turns, people and failed tool calls per day, by the model the conversation last ran on, the turn state and the failure code.",
    input: z.object({ ...rangeInput, ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          /** UTC day the turn was created, YYYY-MM-DD. */
          day: z.string(),
          /** The latest turn's catalogue model, `<provider>/other` outside it, or `unknown`. */
          model: z.string(),
          turnState: z.string(),
          failureCode: z.string().nullable(),
          /** Failed tool calls by tool label. */
          toolErrorsByTool: countsByCode,
          turns: z.number().int(),
          /** Distinct conversation owners. */
          users: z.number().int(),
          /** False when the read stopped at 50,000 turns: counts are floors. */
          turnScanComplete: z.boolean(),
        })
        .strict(),
    ),
  }),
  "org.langy_turn": entry({
    title: "One Langy conversation's turns and tool calls, without text",
    scope: "org",
    answers:
      "What Langy did in one conversation: each turn's state and failure code, and each tool call's tool, status, card and target id.",
    input: z
      .object({
        projectId: z.string().min(1).max(128),
        conversationId: z.string().min(1).max(128),
        ...pageInput,
      })
      .strict(),
    output: staffAccessPageSchema(
      z
        .object({
          turnId: z.string(),
          createdAt: isoTime,
          startedAt: isoTime.nullable(),
          endedAt: isoTime.nullable(),
          state: z.string(),
          failureCode: z.string().nullable(),
          /** At most 100 per turn, in the order they began; never a next cursor. */
          toolCalls: staffAccessPageSchema(toolCallShape),
        })
        .strict(),
    ),
  }),
} as const satisfies Record<string, StaffAccessFunctionEntry>;

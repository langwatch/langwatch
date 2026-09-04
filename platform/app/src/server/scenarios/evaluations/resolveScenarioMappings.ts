/**
 * Resolves the mapped inputs of one evaluator attachment from what a scenario
 * run left behind: its messages, its scenario, and the spans of its traces.
 *
 * Pure functions over plain values, so the rules are testable without a
 * store. Where a value is used comes from the run worker; what a mapping
 * reads and why it cannot is decided here.
 *
 * @see specs/scenarios/scenario-evaluators.feature
 */

import { extractChunkTextualContent } from "~/server/tracer/collector/rag";
import { stringifySpanIO } from "~/server/tracer/spanIOStringify";
import type { Span } from "~/server/tracer/types";
import type {
  EvaluatorAttachment,
  EvaluatorInputSpec,
  ScenarioMapping,
} from "../evaluator-attachments";
import {
  TOOL_CALL_PARTS,
  TRACE_CONTEXTS_PATH,
  TRACE_TOOL_CALLS_PATH,
} from "../evaluator-attachments";
import { fieldValueIsBlank, type ScenarioFieldValues } from "../suite-fields";
import { MAX_STORED_INPUT_LENGTH } from "./constants";

/** One turn of the run's conversation. */
export interface ConversationMessage {
  role: string;
  content: string;
}

/** What the scenario itself answers with. */
export interface ScenarioInputs {
  situation: string;
  criteria: string[];
  fields: ScenarioFieldValues;
}

/** What one run offers to the mappings. */
export interface RunInputs {
  messages: ConversationMessage[];
  /** The spans of every trace the run produced; empty until they arrive. */
  spans: Span[];
  /** Whether the run produced any trace at all. */
  hasTraces: boolean;
}

/** The value one input resolved to; a list for contexts-like inputs. */
export type ResolvedValue = string | string[];

/**
 * How one mapping resolved.
 *
 * `pending` means the trace should hold the value but the spans have not
 * arrived yet, so the worker may try again later; `failed` means the run
 * cannot answer at all; `skipped` means the scenario has no value for it.
 */
export type ResolvedInput =
  | { kind: "value"; value: ResolvedValue }
  | { kind: "skipped"; details: string }
  | { kind: "failed"; details: string }
  | { kind: "pending"; details: string };

export const value = (resolved: ResolvedValue): ResolvedInput => ({
  kind: "value",
  value: resolved,
});
const skipped = (details: string): ResolvedInput => ({
  kind: "skipped",
  details,
});
const failed = (details: string): ResolvedInput => ({
  kind: "failed",
  details,
});
const pending = (details: string): ResolvedInput => ({
  kind: "pending",
  details,
});

const USER_ROLE = "user";
const AGENT_ROLE = "assistant";

/** What the conversation source answers for one path. */
export function resolveConversationMapping({
  path,
  messages,
}: {
  path: readonly string[];
  messages: ConversationMessage[];
}): ResolvedInput {
  switch (path[0]) {
    case "first_user_message": {
      const message = messages.find((entry) => entry.role === USER_ROLE);
      return message
        ? value(message.content)
        : failed("no user message in the conversation");
    }
    case "last_agent_message": {
      const message = [...messages]
        .reverse()
        .find((entry) => entry.role === AGENT_ROLE);
      return message
        ? value(message.content)
        : failed("no agent message in the conversation");
    }
    case "transcript":
      return value(
        messages.map((entry) => `${entry.role}: ${entry.content}`).join("\n"),
      );
    case "messages":
      return value(JSON.stringify(messages));
    default:
      return failed(`the conversation has no ${path.join(".")}`);
  }
}

/** What the scenario source answers for one path. */
export function resolveScenarioMapping({
  path,
  scenario,
}: {
  path: readonly string[];
  scenario: ScenarioInputs;
}): ResolvedInput {
  const [head, identifier] = path;
  if (head === "situation") return value(scenario.situation);
  if (head === "criteria") return value(scenario.criteria.join("\n"));
  if (head === "fields" && identifier) {
    const fieldValue = scenario.fields[identifier];
    return fieldValueIsBlank(fieldValue)
      ? skipped(`no ${identifier} on this scenario`)
      : value(String(fieldValue));
  }
  return failed(`the scenario has no ${path.join(".")}`);
}

const TOOL_SPAN_TYPE = "tool";
const RAG_SPAN_TYPE = "rag";

/**
 * The name a tool span was called by: the `gen_ai.tool.name` attribute when
 * the emitter set it, else the span's own name.
 */
export function toolNameOf(span: Span): string | null {
  const params = span.params as Record<string, unknown> | null | undefined;
  const genAi = params?.gen_ai as Record<string, unknown> | undefined;
  const tool = genAi?.tool as Record<string, unknown> | undefined;
  const name = tool?.name;
  if (typeof name === "string" && name.length > 0) return name;
  return span.name ?? null;
}

const startedAtOf = (span: Span): number =>
  span.timestamps?.started_at ?? Number.MAX_SAFE_INTEGER;

/** The tool spans called by the given name, in the order they started. */
export function toolCallsNamed({
  spans,
  toolName,
}: {
  spans: Span[];
  toolName: string;
}): Span[] {
  return spans
    .filter(
      (span) => span.type === TOOL_SPAN_TYPE && toolNameOf(span) === toolName,
    )
    .sort((a, b) => startedAtOf(a) - startedAtOf(b));
}

/** The text of every context the run's rag spans retrieved, in order. */
export function retrievedContextsOf(spans: Span[]): string[] {
  return spans
    .filter((span) => span.type === RAG_SPAN_TYPE)
    .sort((a, b) => startedAtOf(a) - startedAtOf(b))
    .flatMap((span) =>
      ("contexts" in span ? (span.contexts ?? []) : []).map((chunk) =>
        extractChunkTextualContent(chunk.content),
      ),
    )
    .filter((text) => text.length > 0);
}

/** What the trace's retrieved contexts answer, or why they cannot yet. */
function resolveTraceContextsMapping({
  spans,
  notYet,
}: {
  spans: Span[];
  notYet: (reason: string) => ResolvedInput;
}): ResolvedInput {
  const contexts = retrievedContextsOf(spans);
  if (contexts.length > 0) return value(contexts);
  return notYet("no retrieved contexts in the trace");
}

/** What the last call of the named tool answers, or why it cannot yet. */
function resolveTraceToolCallMapping({
  toolName,
  part,
  spans,
  notYet,
}: {
  toolName: string;
  part: string | undefined;
  spans: Span[];
  notYet: (reason: string) => ResolvedInput;
}): ResolvedInput {
  const call = toolCallsNamed({ spans, toolName }).at(-1);
  if (!call) return notYet(`no ${toolName} call in the trace`);
  const io = part === "input" ? call.input : call.output;
  return value(stringifySpanIO(io) ?? "");
}

/**
 * What the trace source answers for one path. The last call of a tool wins,
 * the way a person reads the final answer of an agent that retried.
 */
export function resolveTraceMapping({
  path,
  spans,
  hasTraces,
}: {
  path: readonly string[];
  spans: Span[];
  hasTraces: boolean;
}): ResolvedInput {
  const [head, toolName, part] = path;
  const notYet = hasTraces && spans.length === 0 ? pending : failed;

  if (head === TRACE_CONTEXTS_PATH) {
    return resolveTraceContextsMapping({ spans, notYet });
  }

  if (
    head === TRACE_TOOL_CALLS_PATH &&
    toolName &&
    (TOOL_CALL_PARTS as readonly string[]).includes(part ?? "")
  ) {
    return resolveTraceToolCallMapping({ toolName, part, spans, notYet });
  }

  return failed(`the trace has no ${path.join(".")}`);
}

/** What one mapping resolves to against the run. */
export function resolveMapping({
  mapping,
  run,
  scenario,
}: {
  mapping: ScenarioMapping;
  run: RunInputs;
  scenario: ScenarioInputs;
}): ResolvedInput {
  if (mapping.type === "value") return value(mapping.value);
  switch (mapping.sourceId) {
    case "conversation":
      return resolveConversationMapping({
        path: mapping.path,
        messages: run.messages,
      });
    case "scenario":
      return resolveScenarioMapping({ path: mapping.path, scenario });
    case "trace":
      return resolveTraceMapping({
        path: mapping.path,
        spans: run.spans,
        hasTraces: run.hasTraces,
      });
  }
}

/** How a whole attachment resolved: every input, or the first reason it cannot run. */
export type ResolvedAttachmentInputs =
  | { kind: "ready"; data: Record<string, ResolvedValue> }
  | { kind: "skipped"; details: string }
  | { kind: "failed"; details: string }
  | { kind: "pending"; details: string };

/** What resolving one input of an attachment does to the loop that reads it. */
type InputResolutionOutcome =
  | { action: "return"; result: ResolvedAttachmentInputs }
  | { action: "set"; id: string; value: ResolvedValue }
  | { action: "pending"; details: string }
  | { action: "failed"; details: string }
  | { action: "skip" };

/**
 * How one input of an attachment resolves against the run, and what that
 * means for the attachment as a whole: a required input with no mapping or a
 * mapping that resolves to `skipped` ends the attachment outright; an
 * optional input the run cannot give yet, or ever, is left out instead.
 */
function resolveAttachmentInput({
  input,
  attachment,
  run,
  scenario,
  finalAttempt,
}: {
  input: EvaluatorInputSpec;
  attachment: Pick<EvaluatorAttachment, "mappings">;
  run: RunInputs;
  scenario: ScenarioInputs;
  finalAttempt: boolean;
}): InputResolutionOutcome {
  const mapping = attachment.mappings[input.id];
  if (!mapping) {
    if (!input.required) return { action: "skip" };
    return {
      action: "return",
      result: { kind: "skipped", details: `no mapping for ${input.id}` },
    };
  }

  const resolved = resolveMapping({ mapping, run, scenario });
  switch (resolved.kind) {
    case "value":
      return { action: "set", id: input.id, value: resolved.value };
    case "skipped":
      return {
        action: "return",
        result: { kind: "skipped", details: resolved.details },
      };
    case "pending":
      if (!input.required && finalAttempt) return { action: "skip" };
      return { action: "pending", details: resolved.details };
    case "failed":
      if (!input.required) return { action: "skip" };
      return { action: "failed", details: resolved.details };
  }
}

/**
 * Resolves every input the evaluator declares through the attachment's
 * mappings.
 *
 * A blank scenario field wins over everything: the scenario has nothing to
 * grade, so there is no point waiting for the trace. Then a trace that has
 * not arrived (the worker retries), then a value the run cannot give at all.
 * An optional input with no mapping is left out; a required one with no
 * mapping is reported as skipped, since the evaluator cannot run without it.
 * An optional input the run cannot give is left out the same way, and one
 * whose trace has not arrived is left out on the last attempt.
 */
export function resolveAttachmentInputs({
  attachment,
  inputs,
  run,
  scenario,
  finalAttempt = false,
}: {
  attachment: Pick<EvaluatorAttachment, "mappings">;
  inputs: EvaluatorInputSpec[];
  run: RunInputs;
  scenario: ScenarioInputs;
  /** True when no later attempt will wait for the trace. */
  finalAttempt?: boolean;
}): ResolvedAttachmentInputs {
  const data: Record<string, ResolvedValue> = {};
  let firstPending: string | undefined;
  let firstFailed: string | undefined;

  for (const input of inputs) {
    const outcome = resolveAttachmentInput({
      input,
      attachment,
      run,
      scenario,
      finalAttempt,
    });
    switch (outcome.action) {
      case "return":
        return outcome.result;
      case "set":
        data[outcome.id] = outcome.value;
        break;
      case "pending":
        firstPending ??= outcome.details;
        break;
      case "failed":
        firstFailed ??= outcome.details;
        break;
      case "skip":
        break;
    }
  }

  if (firstPending) return { kind: "pending", details: firstPending };
  if (firstFailed) return { kind: "failed", details: firstFailed };
  return { kind: "ready", data };
}

/** Whether any mapping of the attachments reads the trace source. */
export function attachmentsReadTrace(
  attachments: readonly Pick<EvaluatorAttachment, "mappings">[],
): boolean {
  return attachments.some((attachment) =>
    Object.values(attachment.mappings).some(
      (mapping) => mapping.type === "source" && mapping.sourceId === "trace",
    ),
  );
}

/** The resolved inputs as the result stores them: text, cut for the UI. */
export function storedInputsOf(
  data: Record<string, ResolvedValue>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data).map(([key, entry]) => [
      key,
      (Array.isArray(entry) ? entry.join("\n") : entry).slice(
        0,
        MAX_STORED_INPUT_LENGTH,
      ),
    ]),
  );
}

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import chalk from "chalk";

import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import type { EvaluatorAttachment } from "@/client-sdk/services/test-suites";
import {
  type EvaluatorInputSpec,
  attachmentMissingInputs,
  evaluatorAttachmentsSchema,
  inferScenarioMappings,
  scenarioMappingPathIssue,
} from "@/internal/generated/types/evaluator-attachments";
import type { SuiteFieldDefinition } from "@/internal/generated/types/suite-fields";

import { commandValidationError, reportCommandError } from "../../utils/errorOutput";

// The --evaluator family of flags; --required/--not-required apply to prior evaluator.

export const EVALUATOR_FLAG = "--evaluator";
export const EVALUATORS_JSON_FLAG = "--evaluators-json";

/** One `--evaluator`, with the gate flag that followed it, when one did. */
export interface EvaluatorFlagRef {
  reference: string;
  required?: boolean;
}

const rejectFlag = (message: string): never => {
  reportCommandError({ error: commandValidationError(message) });
  process.exit(1);
};

const newAttachmentId = (): string => `att_${randomUUID().replace(/-/g, "").slice(0, 21)}`;

/** The input specs of a saved evaluator, as the mapping rules read them. */
const inputsOf = (evaluator: {
  fields: { identifier: string; optional?: boolean }[];
}): EvaluatorInputSpec[] =>
  evaluator.fields.map((field) => ({
    id: field.identifier,
    required: !field.optional,
  }));

/** The attachments built from `--evaluator` flags, with a name to print each one by. */
export interface ResolvedEvaluatorAttachment {
  attachment: EvaluatorAttachment;
  name: string;
  /** The required inputs the rules could not map. */
  missing: string[];
}

// Convert --evaluator references to attachments after platform lookup.
export async function resolveEvaluatorAttachments({
  refs,
  fields,
  isPlanLevel,
  service,
}: {
  refs: EvaluatorFlagRef[];
  fields: SuiteFieldDefinition[];
  isPlanLevel?: boolean;
  service?: EvaluatorsApiService;
}): Promise<ResolvedEvaluatorAttachment[]> {
  const evaluators = service ?? new EvaluatorsApiService();
  const resolved: ResolvedEvaluatorAttachment[] = [];
  for (const ref of refs) {
    let evaluator: Awaited<ReturnType<EvaluatorsApiService["get"]>>;
    try {
      evaluator = await evaluators.get(ref.reference);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return rejectFlag(
        `Evaluator "${ref.reference}" could not be read: ${detail}. List the evaluators with: langwatch evaluator list`,
      );
    }
    const inputs = inputsOf(evaluator);
    const attachment: EvaluatorAttachment = {
      id: newAttachmentId(),
      evaluatorId: evaluator.id,
      required:
        ref.required ?? evaluator.outputFields.some((field) => field.identifier === "passed"),
      mappings: inferScenarioMappings({
        inputs,
        ctx: { fields, toolNames: [] },
        isPlanLevel,
      }),
    };
    resolved.push({
      attachment,
      name: evaluator.name,
      missing: attachmentMissingInputs({ attachment, inputs }).map((input) => input.id),
    });
  }
  return resolved;
}

/** Says, on stderr, which inputs still need a mapping before a run. */
export function warnMissingMappings(resolved: ResolvedEvaluatorAttachment[]): void {
  for (const { name, missing } of resolved) {
    if (missing.length === 0) continue;
    console.error(
      chalk.yellow(
        `Evaluator "${name}" has no mapping for: ${missing.join(", ")}. A run is refused until it is set, with ${EVALUATORS_JSON_FLAG} or in the suite editor.`,
      ),
    );
  }
}

/**
 * The attachment list the flags describe, or none if no evaluator flag was
 * written. `--evaluators-json` is the full list; `--evaluator` references
 * resolve against the fields. Both may be given; the list is their concatenation.
 */
export async function readEvaluators({
  options,
  fields,
  isPlanLevel,
  service,
}: {
  options: { evaluators?: EvaluatorFlagRef[]; evaluatorsJson?: string };
  fields: SuiteFieldDefinition[];
  isPlanLevel?: boolean;
  service?: EvaluatorsApiService;
}): Promise<EvaluatorAttachment[] | undefined> {
  const fromJson =
    options.evaluatorsJson !== undefined
      ? readEvaluatorsJson({ value: options.evaluatorsJson, fields, isPlanLevel })
      : undefined;
  const fromRefs =
    options.evaluators !== undefined && options.evaluators.length > 0
      ? await resolveEvaluatorAttachments({
          refs: options.evaluators,
          fields,
          isPlanLevel,
          service,
        })
      : undefined;
  if (fromRefs) warnMissingMappings(fromRefs);
  if (fromJson === undefined && fromRefs === undefined) return undefined;
  return [...(fromJson ?? []), ...(fromRefs ?? []).map((resolved) => resolved.attachment)];
}

/**
 * Reads `--evaluators-json`: a path to a JSON file or the JSON itself, the
 * full attachment list. `id`/`required` may be omitted (generated / defaults
 * required). Every mapping path is checked against the suite's fields.
 */
export function readEvaluatorsJson({
  value,
  fields,
  isPlanLevel,
}: {
  value: string;
  fields: SuiteFieldDefinition[];
  isPlanLevel?: boolean;
}): EvaluatorAttachment[] {
  const text = existsSync(value) ? readFileSync(value, "utf8") : value;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return rejectFlag(
      `Invalid ${EVALUATORS_JSON_FLAG} value: not a JSON document and not a file that holds one`,
    );
  }
  const withDefaults = Array.isArray(raw)
    ? raw.map((entry) =>
        entry && typeof entry === "object"
          ? {
              id: newAttachmentId(),
              required: true,
              ...(entry as Record<string, unknown>),
            }
          : entry,
      )
    : raw;
  const parsed = evaluatorAttachmentsSchema.safeParse(withDefaults);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return rejectFlag(
      `Invalid ${EVALUATORS_JSON_FLAG} value at ${issue?.path.length ? issue.path.join(".") : "root"}: ${issue?.message ?? "not an attachment list"}`,
    );
  }
  for (const attachment of parsed.data) {
    validateEvaluatorMappings({ attachment, fields, isPlanLevel });
  }
  return parsed.data;
}

function validateEvaluatorMappings({
  attachment,
  fields,
  isPlanLevel,
}: {
  attachment: EvaluatorAttachment;
  fields: SuiteFieldDefinition[];
  isPlanLevel?: boolean;
}): void {
  for (const [input, mapping] of Object.entries(attachment.mappings)) {
    const check = scenarioMappingPathIssue({
      mapping,
      ctx: { fields },
      isPlanLevel,
    });
    if (check.kind === "unreadable") {
      return rejectFlag(
        `Invalid mapping for ${input} on evaluator ${attachment.evaluatorId}: ${check.reason}`,
      );
    }
  }
}

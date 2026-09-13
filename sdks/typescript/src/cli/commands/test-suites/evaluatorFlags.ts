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
import {
  commandValidationError,
  reportCommandError,
} from "../../utils/errorOutput";

/**
 * The `--evaluator` family of flags: which saved evaluators to attach, and
 * whether each one gates the scenario.
 *
 * `--evaluator <id|slug>` repeats, one evaluator per occurrence, and the
 * mappings of each one are inferred from its inputs against the suite's
 * fields, the way the platform infers them when an evaluator is picked in
 * the suite editor. `--required` and `--not-required` apply to the
 * `--evaluator` written just before them. `--evaluators-json` carries the
 * full attachments instead, for a mapping the rules do not infer, such as a
 * tool call.
 *
 * @see specs/features/test-suite-cli.feature
 */

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

const newAttachmentId = (): string =>
  `att_${randomUUID().replace(/-/g, "").slice(0, 21)}`;

/** The input specs of a saved evaluator, as the mapping rules read them. */
const inputsOf = (evaluator: {
  fields: Array<{ identifier: string; optional?: boolean }>;
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

/**
 * Turns the `--evaluator` references into attachments.
 *
 * Every reference is read from the platform first, so a slug that names
 * nothing ends the command before anything is written. The gate defaults to
 * required for an evaluator that produces `passed`, and to reporting only for
 * a score-only one. A required input the rules cannot map is reported on
 * stderr rather than refused: the platform accepts the attachment and refuses
 * the run until the mapping is set.
 */
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
        ref.required ??
        evaluator.outputFields.some((field) => field.identifier === "passed"),
      mappings: inferScenarioMappings({
        inputs,
        ctx: { fields, toolNames: [] },
        isPlanLevel,
      }),
    };
    resolved.push({
      attachment,
      name: evaluator.name,
      missing: attachmentMissingInputs({ attachment, inputs }).map(
        (input) => input.id,
      ),
    });
  }
  return resolved;
}

/** Says, on stderr, which inputs still need a mapping before a run. */
export function warnMissingMappings(
  resolved: ResolvedEvaluatorAttachment[],
): void {
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
 * The attachment list the flags describe, or none when no evaluator flag was
 * written. `--evaluators-json` is the full list; `--evaluator` references are
 * resolved and their mappings inferred against the fields. Both may be
 * given, and the list is their concatenation.
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
  return [
    ...(fromJson ?? []),
    ...(fromRefs ?? []).map((resolved) => resolved.attachment),
  ];
}

/**
 * Reads `--evaluators-json`: a path to a JSON file, or the JSON itself. The
 * document is the full attachment list. An attachment may leave `id` and
 * `required` out; the id is generated and the gate defaults to required.
 * Every mapping path is checked against the suite's fields, so a field the
 * suite does not declare is refused here with the reason.
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
    for (const [input, mapping] of Object.entries(attachment.mappings)) {
      const issue = scenarioMappingPathIssue({
        mapping,
        ctx: { fields },
        isPlanLevel,
      });
      if (issue) {
        return rejectFlag(
          `Invalid mapping for ${input} on evaluator ${attachment.evaluatorId}: ${issue}`,
        );
      }
    }
  }
  return parsed.data;
}

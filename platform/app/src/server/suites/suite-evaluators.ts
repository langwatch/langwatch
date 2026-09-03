/**
 * The domain rules over a suite's fields and evaluator attachments: what a
 * write must satisfy, which attachments a run carries, and which of them
 * still miss a required mapping.
 *
 * The shapes and the mapping grammar live in `server/scenarios/suite-fields`
 * and `server/scenarios/evaluator-attachments`; this module turns their
 * refusals into handled errors and reads them against the project.
 *
 * @see specs/suites/test-suites.feature
 * @see specs/scenarios/scenario-fields.feature
 */

import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import {
  attachmentMissingInputs,
  type EvaluatorAttachment,
  type EvaluatorInputSpec,
  fieldIdentifiersReadBy,
  scenarioMappingPathIssue,
} from "~/server/scenarios/evaluator-attachments";
import {
  SUITE_FIELD_IDENTIFIER_DUPLICATE_MESSAGE,
  type SuiteFieldDefinition,
  suiteFieldDefinitionsSchema,
} from "~/server/scenarios/suite-fields";
import {
  SuiteEvaluatorMappingInvalidError,
  SuiteEvaluatorNotFoundError,
  SuiteFieldIdentifierDuplicateError,
  SuiteFieldIdentifierInvalidError,
  SuiteFieldInUseError,
} from "./errors";

/**
 * The fields a write declares, or the handled refusal.
 *
 * The schema reports the first bad identifier by its position; the error
 * names the identifier itself, which is what the editor shows.
 */
export function readSuiteFieldDefinitions(
  raw: unknown,
): SuiteFieldDefinition[] {
  const parsed = suiteFieldDefinitionsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const index = typeof issue?.path[0] === "number" ? issue.path[0] : undefined;
  const entry =
    index !== undefined && Array.isArray(raw) ? raw[index] : undefined;
  const identifier =
    entry && typeof entry === "object" && "identifier" in entry
      ? String((entry as { identifier: unknown }).identifier)
      : "";
  if (issue?.message === SUITE_FIELD_IDENTIFIER_DUPLICATE_MESSAGE) {
    throw new SuiteFieldIdentifierDuplicateError({ identifier });
  }
  throw new SuiteFieldIdentifierInvalidError({ identifier });
}

/** The inputs an evaluator declares, as the mapping rules read them. */
export function evaluatorInputSpecsOf(
  evaluator: Pick<EvaluatorWithFields, "fields">,
): EvaluatorInputSpec[] {
  return evaluator.fields.map((field) => ({
    id: field.identifier,
    required: !field.optional,
  }));
}

/**
 * The attachments a write carries, checked against the project.
 *
 * Every attachment must name an evaluator the project holds, and every
 * mapping must name a path the run can read. A plan level attachment may not
 * read a scenario field.
 */
export function readEvaluatorAttachments({
  attachments,
  fields,
  planLevel,
  evaluatorsById,
}: {
  attachments: EvaluatorAttachment[];
  fields: SuiteFieldDefinition[];
  planLevel: boolean;
  evaluatorsById: ReadonlyMap<string, Pick<EvaluatorWithFields, "fields">>;
}): EvaluatorAttachment[] {
  for (const attachment of attachments) {
    if (!evaluatorsById.has(attachment.evaluatorId)) {
      throw new SuiteEvaluatorNotFoundError({
        evaluatorId: attachment.evaluatorId,
      });
    }
    for (const [input, mapping] of Object.entries(attachment.mappings)) {
      const reason = scenarioMappingPathIssue({
        mapping,
        ctx: { fields },
        planLevel,
      });
      if (reason !== null) {
        throw new SuiteEvaluatorMappingInvalidError({
          evaluatorId: attachment.evaluatorId,
          input,
          reason,
        });
      }
    }
  }
  return attachments;
}

/**
 * Refuses the removal of a field an attachment still reads.
 *
 * Checked against the attachments as they will be after the write, so a save
 * that removes the field and the mapping together goes through.
 */
export function assertFieldsNotInUse({
  fields,
  attachments,
}: {
  fields: SuiteFieldDefinition[];
  attachments: readonly Pick<EvaluatorAttachment, "evaluatorId" | "mappings">[];
}): void {
  const declared = new Set(fields.map((field) => field.identifier));
  for (const identifier of fieldIdentifiersReadBy(attachments)) {
    if (declared.has(identifier)) continue;
    const evaluatorIds = [
      ...new Set(
        attachments
          .filter((attachment) =>
            fieldIdentifiersReadBy([attachment]).has(identifier),
          )
          .map((attachment) => attachment.evaluatorId),
      ),
    ];
    throw new SuiteFieldInUseError({ identifier, evaluatorIds });
  }
}

/**
 * The attachments one run carries: the suite's first, then the plan's own,
 * an evaluator attached on both sides listed once (the suite's copy wins,
 * because it is the one that may read the suite's fields).
 */
export function mergeRunAttachments({
  suiteAttachments,
  planAttachments,
}: {
  suiteAttachments: readonly EvaluatorAttachment[];
  planAttachments: readonly EvaluatorAttachment[];
}): EvaluatorAttachment[] {
  const seen = new Set<string>();
  const merged: EvaluatorAttachment[] = [];
  for (const attachment of [...suiteAttachments, ...planAttachments]) {
    if (seen.has(attachment.evaluatorId)) continue;
    seen.add(attachment.evaluatorId);
    merged.push(attachment);
  }
  return merged;
}

/** One attachment that still misses a required mapping, and which inputs. */
export type MissingMapping = {
  attachment: EvaluatorAttachment;
  inputs: EvaluatorInputSpec[];
};

/**
 * The attachments whose required inputs have no mapping. An attachment
 * naming an evaluator the map does not hold is reported with no inputs: the
 * evaluator is gone, and the run cannot know what it needed.
 */
export function findMissingMappings({
  attachments,
  evaluatorsById,
}: {
  attachments: readonly EvaluatorAttachment[];
  evaluatorsById: ReadonlyMap<string, Pick<EvaluatorWithFields, "fields">>;
}): MissingMapping[] {
  const missing: MissingMapping[] = [];
  for (const attachment of attachments) {
    const evaluator = evaluatorsById.get(attachment.evaluatorId);
    if (!evaluator) {
      missing.push({ attachment, inputs: [] });
      continue;
    }
    const inputs = attachmentMissingInputs({
      attachment,
      inputs: evaluatorInputSpecsOf(evaluator),
    });
    if (inputs.length > 0) missing.push({ attachment, inputs });
  }
  return missing;
}

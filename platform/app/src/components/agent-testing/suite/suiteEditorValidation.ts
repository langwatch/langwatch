/**
 * The refusals the suite editor writes onto its draft: what it checks before
 * it saves, and where a refusal the server named lands on the draft.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 * @see specs/suites/test-suites.feature
 */

import { describeError, readHandledError } from "~/features/errors";
import {
  SUITE_FIELD_IDENTIFIER_DUPLICATE_MESSAGE,
  type SuiteFieldDefinition,
  suiteFieldDefinitionSchema,
} from "~/server/scenarios/suite-fields";
import { SUITE_NAME_REQUIRED } from "../cases/SuiteNameDialog";
import type { SuiteDraft, SuiteFieldRow } from "./suiteEditorStore";

/** What the editor says about a row with no identifier. */
export const FIELD_IDENTIFIER_REQUIRED = "A field needs an identifier.";

/** The definitions the rows declare, in order. */
export function definitionsOf(
  rows: readonly SuiteFieldRow[],
): SuiteFieldDefinition[] {
  return rows.map((row) => ({
    identifier: row.identifier.trim(),
    type: row.type,
  }));
}

/**
 * One row's refusal: an empty identifier, a malformed one, or one already
 * seen on an earlier row. Records the identifier as seen either way, so a
 * later row with the same identifier reads as a duplicate.
 */
function fieldRowRefusal({
  row,
  seen,
}: {
  row: SuiteFieldRow;
  seen: Set<string>;
}): SuiteFieldRow {
  const identifier = row.identifier.trim();
  if (identifier === "") return { ...row, error: FIELD_IDENTIFIER_REQUIRED };
  const parsed = suiteFieldDefinitionSchema.safeParse({
    identifier,
    type: row.type,
  });
  const issues = parsed.success ? [] : parsed.error.issues;
  const error = issues[0]
    ? issues[0].message
    : seen.has(identifier)
      ? SUITE_FIELD_IDENTIFIER_DUPLICATE_MESSAGE
      : undefined;
  seen.add(identifier);
  return { ...row, error };
}

/**
 * What the editor refuses before it saves: an empty name, an empty or
 * malformed identifier, and two rows with one identifier. Returns the draft
 * with the refusals written on it, or nothing when the draft is complete.
 */
export function refusalsOf(draft: SuiteDraft): SuiteDraft | null {
  const seen = new Set<string>();
  const fields = draft.fields.map((row) => fieldRowRefusal({ row, seen }));
  const nameError = draft.name.trim() === "" ? SUITE_NAME_REQUIRED : undefined;
  const refused = fields.some((row) => row.error) || !!nameError;
  if (!refused) return null;
  return { ...draft, nameError, fields, fieldsError: undefined };
}

/**
 * Places a refusal the server named onto the draft: an identifier refusal
 * under its row, a field or evaluator refusal under its section. Anything
 * else is not the editor's to place, and reads as a toast.
 */
export function placeServerRefusal({
  draft,
  error,
}: {
  draft: SuiteDraft;
  error: unknown;
}): SuiteDraft | null {
  const handled = readHandledError(error);
  if (!handled) return null;
  const message = describeError({ error });
  const identifier =
    typeof handled.meta.identifier === "string" ? handled.meta.identifier : "";
  switch (handled.code) {
    case "suite_field_identifier_invalid":
    case "suite_field_identifier_duplicate": {
      const at = draft.fields.findIndex(
        (row) => row.identifier.trim() === identifier,
      );
      if (at < 0) return { ...draft, fieldsError: message };
      return {
        ...draft,
        fields: draft.fields.map((row, index) =>
          index === at ? { ...row, error: message } : row,
        ),
      };
    }
    case "suite_field_in_use":
      return { ...draft, showFields: true, fieldsError: message };
    case "suite_evaluator_mapping_invalid":
    case "suite_evaluator_not_found":
      return { ...draft, evaluatorsError: message };
    default:
      return null;
  }
}

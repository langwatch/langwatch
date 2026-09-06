import type { TargetConfig } from "../types";

/**
 * A prompt's output field as it arrives from the API / prompt editor.
 *
 * `json_schema` is nullable coming off the prompt row, hence `| null`.
 */
export type PromptOutputField = {
  identifier: string;
  type: string;
  json_schema?: object | null;
};

/**
 * Copy a prompt's output fields onto a workbench target.
 *
 * The one job here is that `json_schema` SURVIVES. A target carries a copy of
 * its prompt's output fields, and every path that wrote that copy used to map
 * it down to `{identifier, type}` — silently dropping the schema. The comparison
 * config derives its per-variant field picker from that schema, so a structured
 * variant offered no fields to pick and could only ever be judged on its whole
 * serialized output (bugbash 2026-07-14).
 *
 * Four separate call sites turn a prompt into a target (select an existing
 * prompt, save a new one, save an edit, load a version). Each one that forgets
 * this re-breaks the picker for prompts saved through it and nothing else, so
 * the mapping lives here rather than being restated at each.
 *
 * A falsy schema is dropped rather than forwarded: `null` fails the Field
 * schema, and an explicit `json_schema: undefined` key is noise.
 */
export const toTargetOutputFields = (
  outputs: PromptOutputField[] | undefined,
): TargetConfig["outputs"] =>
  (outputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as NonNullable<TargetConfig["outputs"]>[number]["type"],
    ...(output.json_schema ? { json_schema: output.json_schema } : {}),
  })) as TargetConfig["outputs"];

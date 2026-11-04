/**
 * Keeps target and evaluator mappings in step with a dataset's columns: a
 * deleted column takes the mappings that read it along, a renamed one carries
 * them to its new name.
 * @see specs/experiments-v3/mapping-validation.feature
 */
import type { EvaluatorConfig, FieldMapping, TargetConfig } from "./types.ts";

type Wiring = { targets: TargetConfig[]; evaluators: EvaluatorConfig[] };

type MappingEdit = (mapping: FieldMapping) => FieldMapping | "remove";

/** One field-to-mapping record with `edit` applied to its dataset mappings. */
const editFields = (
  fields: Record<string, FieldMapping>,
  edit: MappingEdit,
): Record<string, FieldMapping> => {
  const next: Record<string, FieldMapping> = {};
  for (const [field, mapping] of Object.entries(fields)) {
    const isDatasetSource = mapping.type === "source" && mapping.source === "dataset";
    const edited = isDatasetSource ? edit(mapping) : mapping;
    if (edited !== "remove") next[field] = edited;
  }
  return next;
};

/** The wiring with `edit` applied to every dataset mapping under `datasetId`. */
const editWiring = ({
  wiring,
  datasetId,
  targetId,
  edit,
}: {
  wiring: Wiring;
  datasetId: string;
  /** Only this target's mappings and the evaluators' mappings for it. */
  targetId?: string;
  edit: MappingEdit;
}): Wiring => ({
  targets: wiring.targets.map((target) => {
    const fields = target.mappings[datasetId];
    if (!fields || (targetId !== undefined && target.id !== targetId)) return target;
    return { ...target, mappings: { ...target.mappings, [datasetId]: editFields(fields, edit) } };
  }),
  evaluators: wiring.evaluators.map((evaluator) => {
    const perTarget = evaluator.mappings[datasetId];
    if (!perTarget) return evaluator;
    const edited = Object.fromEntries(
      Object.entries(perTarget).map(([id, fields]) => [
        id,
        targetId !== undefined && id !== targetId ? fields : editFields(fields, edit),
      ]),
    );
    return { ...evaluator, mappings: { ...evaluator.mappings, [datasetId]: edited } };
  }),
});

/** The wiring without dataset mappings that read a column `columnNames` lacks. */
export const withoutMappingsToMissingColumns = ({
  wiring,
  datasetId,
  columnNames,
  targetId,
}: {
  wiring: Wiring;
  datasetId: string;
  columnNames: ReadonlySet<string>;
  targetId?: string;
}): Wiring =>
  editWiring({
    wiring,
    datasetId,
    ...(targetId !== undefined ? { targetId } : {}),
    edit: (mapping) =>
      mapping.type === "source" && !columnNames.has(mapping.sourceField) ? "remove" : mapping,
  });

/** The wiring with dataset mappings that read `from` reading `to` instead. */
export const withRenamedColumnMappings = ({
  wiring,
  datasetId,
  from,
  to,
}: {
  wiring: Wiring;
  datasetId: string;
  from: string;
  to: string;
}): Wiring =>
  editWiring({
    wiring,
    datasetId,
    edit: (mapping) =>
      mapping.type === "source" && mapping.sourceField === from
        ? { ...mapping, sourceField: to }
        : mapping,
  });

/**
 * What a target or an evaluator is actually handed at dispatch, and
 * whether it should be dispatched at all. Resolves a cell's mappings into
 * an input record, applies the comparison branch that bypasses per-target
 * mappings, and answers the two dispatch guards: does this evaluator
 * resolve any input, and does this evaluator COLUMN. Both exist because an
 * evaluator resolving nothing does not fail — `exact_match` compares "" to
 * "" and reports a pass, and that pass counts in the run's pass rate.
 */

import {
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
  toComparisonConfig,
  type EvaluatorConfig,
  type ExecutionCell,
  type FieldMapping,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import { AVAILABLE_EVALUATORS, type EvaluatorTypes } from "@langwatch/evaluator-contract";
import type { LoadedEvaluators } from "./experiment-execution-data.service";

export class ExperimentEvaluatorInputService {
  static create({
    loadedEvaluators,
  }: {
    loadedEvaluators?: LoadedEvaluators;
  }): ExperimentEvaluatorInputService {
    return new ExperimentEvaluatorInputService(loadedEvaluators);
  }

  private constructor(private readonly loadedEvaluators: LoadedEvaluators | undefined) {}

  /** A resolved value that carries nothing for the evaluator to read. */
  private isEmptyInputValue(value: unknown): boolean {
    return (
      value === undefined || value === null || (typeof value === "string" && value.trim() === "")
    );
  }

  /**
   * A type's fields from the catalog, required plus optional — an
   * evaluator whose only field is optional is just as broken unmapped.
   */
  private catalogFields(evaluatorType: string | undefined): string[] {
    const definition = AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
    return [...(definition?.requiredFields ?? []), ...(definition?.optionalFields ?? [])];
  }

  /** The fields an evaluator reads: its own declared inputs, or the catalog's otherwise. */
  private declaredEvaluatorFields(evaluator: EvaluatorConfig): string[] {
    const declared = evaluator.inputs?.map((field) => field.identifier) ?? [];
    if (declared.length > 0) return declared;
    return this.catalogFields(evaluator.evaluatorType);
  }

  /**
   * The fields an evaluator COLUMN reads: its own declared inputs, or the
   * catalog fields of the DB evaluator behind it (a target carries the id, not the type).
   */
  private evaluatorTargetFields({ target }: { target: TargetConfig }): string[] {
    const declared = target.inputs?.map((field) => field.identifier) ?? [];
    if (declared.length > 0) return declared;
    const dbConfig = this.loadedEvaluators?.get(target.targetEvaluatorId ?? "")?.config as
      | { evaluatorType?: string }
      | undefined;
    return this.catalogFields(dbConfig?.evaluatorType);
  }

  /** What the row calls the evaluator column that could not run. */
  evaluatorTargetDisplayName({ target }: { target: TargetConfig }): string {
    return (
      target.localEvaluatorConfig?.name ??
      this.loadedEvaluators?.get(target.targetEvaluatorId ?? "")?.name ??
      target.id
    );
  }

  /**
   * Whether dispatching this evaluator COLUMN would hand it nothing to
   * read: `exact_match` comparing "" to "" reports a pass that counts.
   * Exempt: a comparison column, and a precomputed cell.
   */
  evaluatorTargetHasNoResolvedInputs({ cell }: { cell: ExecutionCell }): boolean {
    const target = cell.targetConfig;
    if (target.type !== "evaluator") return false;
    if (cell.comparison || cell.skipTarget) return false;

    const fields = this.evaluatorTargetFields({ target });
    if (fields.length === 0) return false;

    return Object.values(this.buildTargetInputs({ cell })).every((v) => this.isEmptyInputValue(v));
  }

  /**
   * Whether dispatching would hand the evaluator nothing to read: it still
   * produces a RESULT (`exact_match` "" vs "" passes), so the row reports
   * unmapped fields instead. A comparison cell is exempt (see buildCandidates).
   */
  hasNoResolvedInputs({
    cell,
    evaluator,
    inputs,
  }: {
    cell: ExecutionCell;
    evaluator: EvaluatorConfig;
    inputs: Record<string, unknown>;
  }): boolean {
    if (cell.comparison && toComparisonConfig(evaluator)) {
      return !cell.comparison.candidates.some(
        (candidate) => !this.isEmptyInputValue(candidate.output),
      );
    }

    // An evaluator that declares no field reads nothing from the row, so there is
    // nothing to be missing.
    if (this.declaredEvaluatorFields(evaluator).length === 0) return false;

    // An empty payload is the shape the production failure takes: no mapping
    // resolved, so no key was ever written.
    return Object.values(inputs).every((v) => this.isEmptyInputValue(v));
  }

  /**
   * Builds the input values for a target from the cell's dataset entry.
   * Dataset entries are keyed by column NAME at the API boundary, so
   * `mapping.sourceField` is used directly.
   */
  buildTargetInputs({ cell }: { cell: ExecutionCell }): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    const datasetId = cell.datasetEntry._datasetId as string | undefined;
    if (!datasetId) return inputs;

    const mappings = cell.targetConfig.mappings[datasetId] ?? {};

    for (const [inputField, mapping] of Object.entries(mappings)) {
      if (mapping.type === "source" && mapping.source === "dataset") {
        inputs[inputField] = cell.datasetEntry[mapping.sourceField];
      } else if (mapping.type === "value") {
        inputs[inputField] = mapping.value;
      }
    }

    return inputs;
  }

  // Resolves `inputs.input` from the variant's dataset mapping, or falls
  // back to the dataset's `input` column. Mutating helper, kept to preserve
  // the original behavior of setting `inputs.input = undefined` on a
  // missing-column mapping, which downstream consumers tolerate.
  private assignMappedInput({
    inputs,
    mappings,
    datasetEntry,
  }: {
    inputs: Record<string, unknown>;
    mappings: Record<string, FieldMapping>;
    datasetEntry: Record<string, unknown>;
  }): void {
    const inputMapping = mappings.input;
    if (inputMapping?.type === "source" && inputMapping.source === "dataset") {
      inputs.input = datasetEntry[inputMapping.sourceField];
    } else if (datasetEntry.input !== undefined) {
      inputs.input = datasetEntry.input;
    }
  }

  private comparisonEvaluatorInputs({
    cell,
    evaluator,
    datasetId,
    inputs,
  }: {
    cell: ExecutionCell;
    evaluator: EvaluatorConfig;
    datasetId: string;
    inputs: Record<string, unknown>;
  }): Record<string, unknown> {
    const comparisonConfig = toComparisonConfig(evaluator)!;
    const firstVariantId = comparisonConfig.variants[0];
    const firstVariantMappings = firstVariantId
      ? (evaluator.mappings[datasetId]?.[firstVariantId] ?? {})
      : {};
    this.assignMappedInput({
      inputs,
      mappings: firstVariantMappings,
      datasetEntry: cell.datasetEntry,
    });

    // Golden is optional (#5378). Only send it when the user opted into
    // golden-answer comparison AND picked a column. Missing either → the
    // judge sees no reference and compares candidates on their own merits.
    if (comparisonConfig.hasGoldenAnswer !== false && comparisonConfig.goldenField) {
      inputs.golden = cell.datasetEntry[comparisonConfig.goldenField];
    }

    // The judge that actually runs is resolved server-side from the DB
    // row, so `evaluator.evaluatorType` here is accurate. A legacy
    // `pairwise_compare` judge expects the two-slot shape, not `candidates`.
    if (evaluator.evaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE) {
      const [candidateA, candidateB] = cell.comparison!.candidates;
      if (candidateA) {
        inputs.candidate_a_id = candidateA.id;
        inputs.candidate_a_output = candidateA.output;
        inputs.candidate_a_cost = candidateA.cost;
        inputs.candidate_a_duration = candidateA.duration;
      }
      if (candidateB) {
        inputs.candidate_b_id = candidateB.id;
        inputs.candidate_b_output = candidateB.output;
        inputs.candidate_b_cost = candidateB.cost;
        inputs.candidate_b_duration = candidateB.duration;
      }
    } else {
      inputs.candidates = cell.comparison!.candidates.map((c) => ({
        id: c.id,
        output: c.output,
        cost: c.cost,
        duration: c.duration,
      }));
      // Seeds the judge's deterministic candidate shuffle (randomize_order).
      inputs.row_index = cell.rowIndex;
    }

    // Defensive fallback: pull a lost candidate value from the per-row
    // synthetic value mappings generateComparisonCells bakes onto
    // column-target cells (#5131) — only fires when the primary read left it undefined.
    const cellMappings = evaluator.mappings[datasetId]?.[cell.targetId] ?? {};
    for (const [field, mapping] of Object.entries(cellMappings)) {
      if (mapping.type === "value" && mapping.value !== undefined && inputs[field] === undefined) {
        inputs[field] = mapping.value;
      }
    }

    return inputs;
  }

  private mappedEvaluatorInputs({
    cell,
    datasetId,
    evaluator,
    targetOutput,
    inputs,
  }: {
    cell: ExecutionCell;
    datasetId: string;
    evaluator: EvaluatorConfig;
    targetOutput: Record<string, unknown>;
    inputs: Record<string, unknown>;
  }): Record<string, unknown> {
    const mappings = evaluator.mappings[datasetId]?.[cell.targetId] ?? {};

    for (const [inputField, mapping] of Object.entries(mappings)) {
      if (mapping.type === "source") {
        if (mapping.source === "dataset") {
          inputs[inputField] = cell.datasetEntry[mapping.sourceField];
        } else if (mapping.source === "target" && mapping.sourceId === cell.targetId) {
          inputs[inputField] = targetOutput[mapping.sourceField];
        }
      } else if (mapping.type === "value") {
        inputs[inputField] = mapping.value;
      }
    }

    return inputs;
  }

  /**
   * Builds the per-evaluator dispatch input from target output + dataset
   * entry. Exported for unit testing: the comparison branch is where
   * #5528's legacy-pairwise/N-way payload-shape bug lives.
   */
  buildEvaluatorInputs({
    cell,
    evaluatorId,
    targetOutput,
  }: {
    cell: ExecutionCell;
    evaluatorId: string;
    targetOutput: Record<string, unknown>;
  }): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    const datasetId = cell.datasetEntry._datasetId as string | undefined;
    if (!datasetId) return inputs;

    const evaluator = cell.evaluatorConfigs.find((e) => e.id === evaluatorId);
    if (!evaluator) return inputs;

    const comparisonConfig = toComparisonConfig(evaluator);
    if (comparisonConfig && cell.comparison) {
      return this.comparisonEvaluatorInputs({ cell, evaluator, datasetId, inputs });
    }

    return this.mappedEvaluatorInputs({ cell, datasetId, evaluator, targetOutput, inputs });
  }
}

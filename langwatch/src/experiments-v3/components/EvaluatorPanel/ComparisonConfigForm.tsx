import {
  Box,
  Button,
  Field,
  HStack,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { Menu } from "~/components/ui/menu";
import { Switch } from "~/components/ui/switch";

import { useTargetName, useTargetNames } from "../../hooks/useTargetName";
import { useTargetOutputs } from "../../hooks/useTargetOutputs";
import type { ComparisonEvaluatorConfig, TargetConfig } from "../../types";
import { balancedColumns } from "../../utils/balancedColumns";
import { disambiguateNames } from "../../utils/variantDisambiguation";

type Metric = "cost" | "duration";
type VariantOutputOption = {
  label: string;
  path: string[];
};

/**
 * The four default judge prompts, one per (golden × input) presence combo.
 * Each mirrors the langevals evaluator's shipped default VERBATIM (including
 * whitespace) — kept in sync with select_best_compare.py so the auto-swap
 * equality check below recognizes an untouched prompt. When the reference
 * answer or the task context is absent, its framing is dropped entirely
 * rather than left as an empty "Reference: " / "Task: " line, which confuses
 * the judge more than removing it.
 */
const JUDGE_PROMPT_GOLDEN_INPUT =
  'Pick the best of N candidate replies to the task.\n\nTask:       {input}\nReference:  {golden}\n\nCandidates:\n{candidates}\n\nLook across the candidates and decide which one is the best reply.\nBriefly explain WHY it\'s better than the others, then pick the winning\nslot label. Use "tie" only when no candidate is clearly better.\n';

const JUDGE_PROMPT_GOLDEN_NO_INPUT =
  'Pick the best of N candidate replies.\n\nReference:  {golden}\n\nCandidates:\n{candidates}\n\nCompare each candidate against the reference answer and decide which one\nis closest. Briefly explain WHY it\'s better than the others, then pick the\nwinning slot label. Use "tie" only when no candidate is clearly better.\n';

const JUDGE_PROMPT_NO_GOLDEN_INPUT =
  'Pick the best of N candidate replies to the task — there is no reference\nanswer, so compare them on their own merits.\n\nTask:  {input}\n\nCandidates:\n{candidates}\n\nLook across the candidates and decide which one is the best reply.\nBriefly explain WHY it\'s better than the others, then pick the winning\nslot label. Use "tie" only when no candidate is clearly better.\n';

const JUDGE_PROMPT_NO_GOLDEN_NO_INPUT =
  'Pick the best of N candidate replies — there is no task description or\nreference answer, so compare them on their own merits.\n\nCandidates:\n{candidates}\n\nLook across the candidates and decide which one is the best reply.\nBriefly explain WHY it\'s better than the others, then pick the winning\nslot label. Use "tie" only when no candidate is clearly better.\n';

/** Every shipped default, so an untouched prompt can be detected regardless
 * of which combo it was last defaulted to (hand-tuned prompts never match). */
const ALL_DEFAULT_JUDGE_PROMPTS = [
  JUDGE_PROMPT_GOLDEN_INPUT,
  JUDGE_PROMPT_GOLDEN_NO_INPUT,
  JUDGE_PROMPT_NO_GOLDEN_INPUT,
  JUDGE_PROMPT_NO_GOLDEN_NO_INPUT,
];

/** The default prompt for a given presence combo — the judge prompt adapts
 * to what the row actually gives it (a reference answer, task context, both,
 * or neither). */
export function pickDefaultJudgePrompt({
  hasGolden,
  hasInput,
}: {
  hasGolden: boolean;
  hasInput: boolean;
}): string {
  if (hasGolden) {
    return hasInput ? JUDGE_PROMPT_GOLDEN_INPUT : JUDGE_PROMPT_GOLDEN_NO_INPUT;
  }
  return hasInput ? JUDGE_PROMPT_NO_GOLDEN_INPUT : JUDGE_PROMPT_NO_GOLDEN_NO_INPUT;
}

/**
 * Configuration form for the langevals/select_best_compare evaluator — the one
 * Comparison flow, whether it compares two candidates or ten (#5100, #5101).
 * Four configurable sections:
 *
 *   1. Variants   — multiselect of ≥2 TargetConfig ids whose per-row
 *                   outputs are the candidates the judge picks between
 *   2. Golden     — dataset column whose value is the reference answer
 *   3. Shuffle    — candidate-order randomization, mirrored into
 *                   `settings.randomize_order`
 *   4. Metrics    — cost / duration toggles mirrored into `settings.include_metrics`
 *
 * A single judge call per row picks a winner; candidate order is shuffled
 * deterministically per row (seeded by rowIndex) to mitigate position bias.
 *
 * This form also renders for experiments saved with the legacy two-slot
 * `pairwise` config, which `toComparisonConfig` folds into `variants` on load.
 */

export type DatasetColumn = { id: string; name: string };

export type ComparisonConfigFormProps = {
  value: ComparisonEvaluatorConfig;
  onChange: (next: ComparisonEvaluatorConfig) => void;
  /** All targets the user has configured (excluding evaluator-as-target). */
  targets: TargetConfig[];
  /** Active dataset columns the user can pick the golden field from. */
  datasetColumns: DatasetColumn[];
  /** Active dataset's name, used only to qualify column labels. */
  datasetName?: string;
};

/**
 * Qualify a field with the source it comes from, e.g. "Test Data.expected_output"
 * or "support-detailed.answer" — the same `Source.field` shape the prompt
 * variable mapping chips use, so a name on its own is never ambiguous about
 * which dataset or variant it belongs to.
 *
 * Display only: the stored value stays the bare field/path the backend reads.
 * Falls back to the bare field when the source is unknown (still loading).
 */
export const qualifyFieldLabel = (
  source: string | undefined,
  field: string,
): string => (source ? `${source}.${field}` : field);

export function ComparisonConfigForm({
  value,
  onChange,
  targets,
  datasetColumns,
  datasetName,
}: ComparisonConfigFormProps) {
  // Local-draft + ref pattern so back-to-back picks against a stale `value`
  // prop don't stomp each other. Parent-pushed value changes still resync
  // `draft`.
  const [draft, setDraft] = useState<ComparisonEvaluatorConfig>(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const update = (patch: Partial<ComparisonEvaluatorConfig>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    onChange(next);
  };

  return (
    <VStack align="stretch" gap={3}>
      <VariantsMultiSelect draft={draft} update={update} targets={targets} />

      <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
        <GoldenAnswerSection
          draft={draft}
          update={update}
          datasetColumns={datasetColumns}
          datasetName={datasetName}
        />

        <InputContextSection
          draft={draft}
          update={update}
          datasetColumns={datasetColumns}
          datasetName={datasetName}
        />
      </SimpleGrid>

      <RandomizeOrderSection draft={draft} update={update} />

      <MetricsSection draft={draft} update={update} />
    </VStack>
  );
}

/**
 * Multi-select over available targets. Requires ≥2 to be picked before
 * the evaluator can save (enforced downstream by the orchestrator's
 * `Select-best evaluator skipped: fewer than 2 variants configured`
 * guard, and mirrored client-side here via a validation message).
 */
function VariantsMultiSelect({
  draft,
  update,
  targets,
}: {
  draft: ComparisonEvaluatorConfig;
  update: (patch: Partial<ComparisonEvaluatorConfig>) => void;
  targets: TargetConfig[];
}) {
  const selected = draft.variants ?? [];
  const remaining = targets.filter((t) => !selected.includes(t.id));
  const outputPaths = draft.variantOutputPaths ?? {};

  // Same-name variants (e.g. a duplicated prompt whose model was changed) must
  // read as "Name (1)", "Name (2)" so the picker card, its verdict column, and
  // the scoreboard all line up one-to-one. Disambiguate over the SELECTED set
  // in variant order — the exact order ComparisonColumnHeader numbers by — so
  // "(2)" here is the same column as "(2)" there. Batched via useTargetNames
  // (shared query cache) since a hook can't be called once per card in a loop.
  const selectedTargets = useMemo(
    () => selected.map((id) => targets.find((t) => t.id === id)),
    [selected, targets],
  );
  const variantNames = useTargetNames(selectedTargets);
  // Resolved through to the prompt when the target's own copy lost its
  // json_schema, so variants saved before that fix still offer their fields.
  const variantOutputs = useTargetOutputs(selectedTargets);
  const variantDisplayNames = useMemo(
    () =>
      disambiguateNames(
        variantNames.map(
          (name, i) => name || selected[i] || `Variant ${i + 1}`,
        ),
      ),
    [variantNames, selected],
  );

  const add = (id: string) => update({ variants: [...selected, id] });

  const remove = (id: string) => {
    const { [id]: _dropped, ...keptPaths } = outputPaths;
    update({
      variants: selected.filter((v) => v !== id),
      variantOutputPaths: Object.keys(keptPaths).length ? keptPaths : undefined,
    });
  };

  // An empty path means "the whole output", which is how a variant with no
  // chosen field is stored — so clearing the choice drops the entry rather
  // than writing [].
  const setOutputPath = (id: string, path: string[]) => {
    const nextPaths = { ...outputPaths };
    if (path.length > 0) nextPaths[id] = path;
    else delete nextPaths[id];

    update({
      variantOutputPaths: Object.keys(nextPaths).length ? nextPaths : undefined,
    });
  };

  // Fewer than 2 variants is not warned about here — it disables Save and
  // Apply in the drawer footer. The label already states the requirement.
  const columns = balancedColumns(selected.length);

  return (
    <Field.Root required flex="1">
      <Field.Label fontSize="13px" color="fg.muted" marginBottom={2}>
        Variants (pick 2 or more)
        <FieldInfoTooltip
          testId="comparison-variants-info"
          trigger="hover"
          description="The columns whose outputs are compared. If a column is already scored by its own evaluators, those scores are passed to the judge along with the output, so it can take them into account."
        />
      </Field.Label>

      <SimpleGrid
        columns={columns}
        gap={3}
        width="100%"
        data-testid="comparison-variants-grid"
        data-columns={columns}
      >
        {selected.map((id, index) => {
          const target = targets.find((t) => t.id === id);
          if (!target) return null;
          return (
            <VariantCard
              key={id}
              target={target}
              name={variantDisplayNames[index] ?? ""}
              // No `?? target.outputs` fallback: undefined means "not resolved
              // yet", and the target's own copy is exactly the schema-less one
              // whose field paths would be wrong. Better a picker that appears
              // a beat late than one that persists a broken path.
              outputs={variantOutputs[index]}
              path={outputPaths[id]}
              onPathChange={(path) => setOutputPath(id, path)}
              onRemove={() => remove(id)}
            />
          );
        })}
      </SimpleGrid>

      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            variant="outline"
            colorPalette="gray"
            size="sm"
            fontWeight="normal"
            marginTop={selected.length > 0 ? 3 : 0}
            alignSelf="start"
            data-testid="comparison-add-variant"
            disabled={remaining.length === 0}
          >
            <Plus size={14} />
            <Text fontSize="13px">
              {selected.length === 0 ? "Add a variant" : "Add another"}
            </Text>
          </Button>
        </Menu.Trigger>
        <Menu.Content portalled={true} maxHeight="240px" overflowY="auto">
          {remaining.length === 0 ? (
            <Menu.Item value="__empty__" disabled>
              <Text fontSize="13px" color="fg.subtle">
                All targets already added
              </Text>
            </Menu.Item>
          ) : (
            remaining.map((t) => (
              <VariantMenuItem key={t.id} target={t} onAdd={() => add(t.id)} />
            ))
          )}
        </Menu.Content>
      </Menu.Root>
    </Field.Root>
  );
}

/** Storage for "compare the whole output" — no field narrowing. */
const WHOLE_OUTPUT = "__whole_output__";

/**
 * One cell of the variants grid: which column, and — when the target emits
 * more than one output field — which of those fields feeds the judge.
 *
 * A variant emitting a structured output needs a way to say "judge the
 * `.answer` field", or the whole object reaches the judge serialized as JSON.
 * Which field to pick is a per-variant call: two variants may name the same
 * answer differently, and the user is the only one who knows they mean the
 * same thing.
 *
 * The picker is hidden when the target has a single output field, because
 * there is no choice to make. That is the common case — a plain prompt
 * declares one `output` field — and the runtime unwraps a single-field
 * target's dict back to a scalar before the judge sees it, so an unset path
 * already feeds the judge the plain string.
 */
function VariantCard({
  target,
  name,
  outputs,
  path,
  onPathChange,
  onRemove,
}: {
  target: TargetConfig;
  /** Already disambiguated by the parent so same-name variants read as
   * "Name (1)" / "Name (2)"; the card must not re-resolve it per-target. */
  name: string;
  /** Effective output fields (resolved through to the prompt when the target's
   * own copy is missing its schema) — resolved by the parent so the batched
   * query runs at a stable hook position. */
  outputs: TargetConfig["outputs"] | undefined;
  path: string[] | undefined;
  onPathChange: (path: string[]) => void;
  onRemove: () => void;
}) {
  const label = name || target.id;
  const outputOptions = getVariantOutputOptions(outputs ?? []);
  // Qualify each field with the variant it belongs to ("support-detailed.answer"),
  // the same Source.field shape the dataset pickers and mapping chips use.
  const qualify = (optionLabel: string) => qualifyFieldLabel(label, optionLabel);
  const selectedLabel =
    outputOptions.find((option) => pathsEqual(option.path, path ?? []))
      ?.label ??
    path?.join(".") ??
    null;

  return (
    <VStack
      align="stretch"
      gap={1.5}
      padding={2.5}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg="bg.subtle"
      data-testid={`comparison-variant-card-${target.id}`}
    >
      <HStack justify="space-between" gap={1}>
        <Text fontSize="13px" fontWeight="medium" lineClamp={1} title={label}>
          {label}
        </Text>
        <Button
          variant="ghost"
          size="xs"
          minWidth="auto"
          padding={0}
          height="18px"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          data-testid={`comparison-variant-chip-${target.id}-remove`}
        >
          <X size={12} />
        </Button>
      </HStack>

      {outputOptions.length > 1 && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="outline"
              colorPalette="gray"
              size="xs"
              fontWeight="normal"
              justifyContent="space-between"
              width="full"
              data-testid={`comparison-variant-output-${target.id}`}
            >
              <Text
                fontSize="12px"
                fontFamily="mono"
                color={path?.length ? "fg" : "fg.subtle"}
                truncate
                title={selectedLabel ? qualify(selectedLabel) : "Whole output"}
              >
                {selectedLabel ? qualify(selectedLabel) : "Whole output"}
              </Text>
              <ChevronDown size={12} color="var(--chakra-colors-fg-muted)" />
            </Button>
          </Menu.Trigger>
          <Menu.Content portalled={true} maxHeight="240px" overflowY="auto">
            <Menu.Item
              value={WHOLE_OUTPUT}
              onClick={() => onPathChange([])}
              data-testid={`comparison-variant-output-${target.id}-option-whole`}
            >
              <Text fontSize="12px" color="fg.subtle">
                Whole output
              </Text>
            </Menu.Item>
            {outputOptions.map((option) => (
              // Keyed on the PATH, not the label: the path is this option's
              // stable identity, while the label is display copy that has
              // already been reworded once — and a test id that moves when copy
              // changes is a test id that breaks for no reason.
              <Menu.Item
                key={option.path.join(".")}
                value={option.path.join(".")}
                onClick={() => onPathChange(option.path)}
                data-testid={`comparison-variant-output-${target.id}-option-${option.path.join(".")}`}
              >
                <Text fontSize="12px" fontFamily="mono" title={qualify(option.label)}>
                  {qualify(option.label)}
                </Text>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
      )}
    </VStack>
  );
}

function pathsEqual(a: string[], b: string[]): boolean {
  return (
    a.length === b.length && a.every((segment, index) => segment === b[index])
  );
}

function getObjectSchemaProperties(schema: unknown): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const properties = (schema as { properties?: unknown }).properties;
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  ) {
    return [];
  }
  return Object.keys(properties);
}

function getVariantOutputOptions(
  outputs: TargetConfig["outputs"],
): VariantOutputOption[] {
  const fields = outputs ?? [];
  const singleOutput = fields.length === 1;

  return fields.flatMap((field) => {
    const properties =
      field.type === "json_schema"
        ? getObjectSchemaProperties(field.json_schema)
        : [];

    if (properties.length === 0) {
      return [{ label: field.identifier, path: [field.identifier] }];
    }

    // Label and path deliberately diverge for a single "output" field.
    //
    // Label names the whole path from the output field down, so a structured
    // variant reads "support-detailed.output.answer" — the same Source.field
    // shape as the dataset pickers and the prompt mapping chips, and it says
    // plainly WHICH output the field came from.
    //
    // The stored path must stay UNWRAPPED though: the backend's
    // extractTargetOutput unwraps a single "output" field before pickOutputPath
    // walks the object, so persisting ["output", "answer"] would leave the
    // judge comparing an empty candidate. Never "simplify" these two to match.
    const nested = properties.map((property) => ({
      label: `${field.identifier}.${property}`,
      path:
        singleOutput && field.identifier === "output"
          ? [property]
          : [field.identifier, property],
    }));

    return singleOutput
      ? nested
      : [{ label: field.identifier, path: [field.identifier] }, ...nested];
  });
}

/**
 * Menu item for a target the user can add. Split into its own component so
 * `useTargetName` runs at a stable hook position (Rules of Hooks) even as
 * the remaining-targets list shrinks with each pick.
 */
function VariantMenuItem({
  target,
  onAdd,
}: {
  target: TargetConfig;
  onAdd: () => void;
}) {
  const name = useTargetName(target) ?? target.id;
  return (
    <Menu.Item
      value={target.id}
      onClick={onAdd}
      data-testid={`comparison-variant-option-${target.id}`}
    >
      <Text fontSize="13px">{name}</Text>
    </Menu.Item>
  );
}

/**
 * Golden field picker. Golden-answer is opt-in (#5378) and is now driven
 * entirely by this picker: choosing a dataset column turns golden ON,
 * choosing "None — judge on merits" turns it OFF. Source of truth is the
 * parent form's `settings.has_golden_answer` (the field the judge reads);
 * `comparison.hasGoldenAnswer` is mirrored on every write so the
 * orchestrator's cell-generation guard and the missing-mappings validator
 * — which only see `evaluator.comparison`, not the evaluator's Python
 * settings — can read it too. Same dual-representation pattern as
 * MetricsSection/include_metrics below.
 */
function GoldenAnswerSection({
  draft,
  update,
  datasetColumns,
  datasetName,
}: {
  draft: ComparisonEvaluatorConfig;
  update: (patch: Partial<ComparisonEvaluatorConfig>) => void;
  datasetColumns: DatasetColumn[];
  datasetName?: string;
}) {
  const formContext = useFormContext<{
    settings?: { has_golden_answer?: boolean; prompt?: string };
  }>();
  const watchedHasGoldenAnswer = useWatch({
    control: formContext?.control,
    name: "settings.has_golden_answer",
  }) as boolean | undefined;
  const watchedPrompt = useWatch({
    control: formContext?.control,
    name: "settings.prompt",
  }) as string | undefined;
  const hasGoldenAnswer =
    (watchedHasGoldenAnswer ?? draft.hasGoldenAnswer) !== false;

  // Keep the judge prompt in sync with the golden setting reactively — on
  // every change of either field, not just a click — so the correct default
  // is enforced regardless of HOW state changed (form init, external
  // setValue, load from persistence). Only swap when the current prompt is
  // still an untouched shipped default (matches ANY of the four defaults,
  // trimmed) so hand-tuned prompts survive. hasInput is always true at config
  // time; the input axis is resolved per row at runtime in Python.
  const isUntouchedDefault = useCallback(
    (value: string | undefined): boolean =>
      typeof value === "string" &&
      ALL_DEFAULT_JUDGE_PROMPTS.some(
        (candidate) => value.trim() === candidate.trim(),
      ),
    [],
  );
  useEffect(() => {
    if (!formContext) return;
    if (typeof watchedHasGoldenAnswer !== "boolean") return;
    if (typeof watchedPrompt !== "string") return;
    if (!isUntouchedDefault(watchedPrompt)) return;
    const nextPrompt = pickDefaultJudgePrompt({
      hasGolden: watchedHasGoldenAnswer !== false,
      hasInput: true,
    });
    if (nextPrompt !== watchedPrompt) {
      formContext.setValue("settings.prompt", nextPrompt, {
        shouldDirty: true,
        shouldTouch: true,
      });
    }
  }, [formContext, watchedHasGoldenAnswer, watchedPrompt, isUntouchedDefault]);

  const setHasGoldenAnswer = (on: boolean) => {
    formContext?.setValue("settings.has_golden_answer", on, {
      shouldDirty: true,
      shouldTouch: true,
    });
    // Prompt-swap now lives in the useEffect above so it always fires
    // regardless of HOW has_golden_answer changed. Only clear goldenField
    // here — that's toggle-specific UX (a stale golden mapping resurfacing
    // is confusing, so drop it when turning golden OFF).
    update({ hasGoldenAnswer: on, ...(on ? {} : { goldenField: "" }) });
  };

  // Reconcile the store's `hasGoldenAnswer` with the form's true source of
  // truth on MOUNT too, not just on click (#5528). Selecting an EXISTING
  // saved comparison evaluator as a new column target seeds `comparison`
  // before this form ever mounts, independently of the evaluator's real
  // persisted `settings.has_golden_answer` — the two can start out
  // mismatched. The toggle above already renders correctly because it reads
  // `watchedHasGoldenAnswer` (the form), which gives false confidence: the
  // underlying store keeps the wrong seeded value until the user clicks the
  // toggle themselves, and that stale value is what gets saved and read at
  // execution time. `update()` only writes to the store/draft, never to the
  // RHF form, so this cannot loop back into `watchedHasGoldenAnswer`.
  useEffect(() => {
    if (typeof watchedHasGoldenAnswer !== "boolean") return;
    if (watchedHasGoldenAnswer === draft.hasGoldenAnswer) return;
    update({
      hasGoldenAnswer: watchedHasGoldenAnswer,
      ...(watchedHasGoldenAnswer === false ? { goldenField: "" } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `update` is
    // recreated every render; including it would re-run this effect on
    // every keystroke elsewhere in the form for no benefit (it's a no-op
    // once draft.hasGoldenAnswer matches the form).
  }, [watchedHasGoldenAnswer, draft.hasGoldenAnswer]);

  // Trigger label: the chosen column, else "None — judge on merits" once
  // golden has been explicitly turned off, else the unselected placeholder.
  const goldenTriggerLabel = draft.goldenField
    ? qualifyFieldLabel(datasetName, draft.goldenField)
    : hasGoldenAnswer === false
      ? "None — judge on merits"
      : "Select a dataset column…";

  return (
    <Box>
      <Field.Root required flex="1">
        <Field.Label fontSize="13px" color="fg.muted" marginBottom={1}>
          Golden field
          <FieldInfoTooltip
            testId="comparison-golden-field-info"
            trigger="hover"
            description="The dataset column holding the reference answer the judge compares each candidate against — usually expected_output. Pick None to judge on merits alone."
          />
        </Field.Label>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="outline"
              colorPalette="gray"
              size="sm"
              fontWeight="normal"
              justifyContent="space-between"
              width="full"
              data-testid="comparison-golden-field"
            >
              <Text
                fontSize="13px"
                color={draft.goldenField ? "fg" : "fg.subtle"}
                truncate
              >
                {goldenTriggerLabel}
              </Text>
              <ChevronDown size={14} color="var(--chakra-colors-fg-muted)" />
            </Button>
          </Menu.Trigger>
          <Menu.Content portalled={true} maxHeight="240px" overflowY="auto">
            <Menu.Item
              value="__none__"
              onClick={() => {
                setHasGoldenAnswer(false);
                update({ goldenField: "" });
              }}
              data-testid="comparison-golden-field-option-none"
            >
              <Text fontSize="13px" color="fg.subtle">
                None — judge on merits
              </Text>
            </Menu.Item>
            {datasetColumns.map((c) => (
              <Menu.Item
                key={c.id}
                value={c.name}
                onClick={() => {
                  setHasGoldenAnswer(true);
                  update({ goldenField: c.name });
                }}
                data-testid={`comparison-golden-field-option-${c.name}`}
              >
                <Text fontSize="13px" fontFamily="mono">
                  {qualifyFieldLabel(datasetName, c.name)}
                </Text>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
      </Field.Root>
    </Box>
  );
}

function InputContextSection({
  draft,
  update,
  datasetColumns,
  datasetName,
}: {
  draft: ComparisonEvaluatorConfig;
  update: (patch: Partial<ComparisonEvaluatorConfig>) => void;
  datasetColumns: DatasetColumn[];
  datasetName?: string;
}) {
  return (
    <Box>
      <Field.Root flex="1">
        <Field.Label fontSize="13px" color="fg.muted" marginBottom={1}>
          Input field
          <FieldInfoTooltip
            testId="comparison-input-field-info"
            trigger="hover"
            description="The dataset column that gives the judge task context. Leave on auto to use an input column when one exists."
          />
        </Field.Label>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="outline"
              colorPalette="gray"
              size="sm"
              fontWeight="normal"
              justifyContent="space-between"
              width="full"
              data-testid="comparison-input-field"
            >
              <Text
                fontSize="13px"
                color={draft.inputField ? "fg" : "fg.subtle"}
                truncate
              >
                {draft.inputField
                  ? qualifyFieldLabel(datasetName, draft.inputField)
                  : "Auto-detect input context"}
              </Text>
              <ChevronDown size={14} color="var(--chakra-colors-fg-muted)" />
            </Button>
          </Menu.Trigger>
          <Menu.Content portalled={true} maxHeight="240px" overflowY="auto">
            <Menu.Item
              value="__auto__"
              onClick={() => update({ inputField: undefined })}
              data-testid="comparison-input-field-option-auto"
            >
              <Text fontSize="13px" color="fg.subtle">
                Auto-detect input context
              </Text>
            </Menu.Item>
            {datasetColumns.map((c) => (
              <Menu.Item
                key={c.id}
                value={c.name}
                onClick={() => update({ inputField: c.name })}
                data-testid={`comparison-input-field-option-${c.name}`}
              >
                <Text fontSize="13px" fontFamily="mono">
                  {qualifyFieldLabel(datasetName, c.name)}
                </Text>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
      </Field.Root>
    </Box>
  );
}

/**
 * "Shuffle candidate order" toggle.
 *
 * LLM judges favour whichever candidate they read first. The judge counters
 * this by shuffling the candidates before every call, deterministically seeded
 * on the row index — so a row presents the same order every time it runs, and
 * re-running an experiment doesn't reshuffle the verdicts underneath the user.
 *
 * On by default. Turning it off is for reproducing a run against a fixed
 * candidate order, not something a normal comparison wants.
 *
 * Source of truth is `settings.randomize_order` (what the Python judge reads);
 * `comparison.randomizeOrder` is mirrored on every write for the code paths
 * that only see `evaluator.comparison`. Same dual-representation pattern as
 * GoldenAnswerSection and MetricsSection.
 */
function RandomizeOrderSection({
  draft,
  update,
}: {
  draft: ComparisonEvaluatorConfig;
  update: (patch: Partial<ComparisonEvaluatorConfig>) => void;
}) {
  const formContext = useFormContext<{
    settings?: { randomize_order?: boolean };
  }>();
  const watched = useWatch({
    control: formContext?.control,
    name: "settings.randomize_order",
  }) as boolean | undefined;
  const randomizeOrder = (watched ?? draft.randomizeOrder) !== false;

  const setRandomizeOrder = (on: boolean) => {
    formContext?.setValue("settings.randomize_order", on, {
      shouldDirty: true,
      shouldTouch: true,
    });
    update({ randomizeOrder: on });
  };

  return (
    <Box paddingTop={2}>
      <HStack justify="space-between" align="start">
        <HStack gap={0} align="center">
          <Text fontSize="13px" fontWeight="medium">
            Shuffle candidate order
          </Text>
          <FieldInfoTooltip
            testId="comparison-randomize-order-info"
            trigger="hover"
            description="Judges tend to favour whichever candidate they read first. Shuffling each row's candidates cancels that out. The same row always gets the same order, so re-running gives you comparable verdicts."
          />
        </HStack>
        <Switch
          checked={randomizeOrder}
          onCheckedChange={({ checked }) => setRandomizeOrder(checked)}
          inputProps={{ "aria-label": "Shuffle candidate order" }}
          data-testid="comparison-randomize-order"
        />
      </HStack>
    </Box>
  );
}

/**
 * Inline metric toggles. Source of truth is `settings.include_metrics`
 * (what the Python judge reads); the legacy `comparison.includeMetrics`
 * mirror is kept in sync on every write so any orchestrator path reading
 * from it doesn't drift. Same dual-representation pattern
 * GoldenAnswerSection uses.
 */
function MetricsSection({
  draft,
  update,
}: {
  draft: ComparisonEvaluatorConfig;
  update: (patch: Partial<ComparisonEvaluatorConfig>) => void;
}) {
  const formContext = useFormContext<{
    settings?: { include_metrics?: Metric[] };
  }>();
  const watchedMetrics = useWatch({
    control: formContext?.control,
    name: "settings.include_metrics",
  }) as Metric[] | undefined;
  const current = (watchedMetrics ?? draft.includeMetrics ?? []) as Metric[];

  const toggle = useCallback(
    ({ metric, on }: { metric: Metric; on: boolean }) => {
      const next = on
        ? Array.from(new Set([...current, metric]))
        : current.filter((m) => m !== metric);
      formContext?.setValue("settings.include_metrics", next, {
        shouldDirty: true,
        shouldTouch: true,
      });
      update({ includeMetrics: next });
    },
    [current, formContext, update],
  );

  return (
    <Box paddingTop={2}>
      <HStack gap={0} align="center" marginBottom={2}>
        <Text
          fontSize="11px"
          fontWeight="bold"
          textTransform="uppercase"
          letterSpacing="wide"
          color="fg.muted"
        >
          Include metrics during judgment
        </Text>
        <FieldInfoTooltip
          testId="comparison-include-metrics-info"
          trigger="hover"
          description="Inject per-candidate cost and latency into the judge prompt so it can prefer the cheaper or faster variant when quality is comparable."
        />
      </HStack>
      <VStack align="stretch" gap={2}>
        <HStack justify="space-between">
          <Text fontSize="13px">Include cost</Text>
          <Switch
            checked={current.includes("cost")}
            onCheckedChange={({ checked }) =>
              toggle({ metric: "cost", on: checked })
            }
            inputProps={{ "aria-label": "Include cost" }}
            data-testid="comparison-include-cost"
          />
        </HStack>
        <HStack justify="space-between">
          <Text fontSize="13px">Include duration</Text>
          <Switch
            checked={current.includes("duration")}
            onCheckedChange={({ checked }) =>
              toggle({ metric: "duration", on: checked })
            }
            inputProps={{ "aria-label": "Include duration" }}
            data-testid="comparison-include-duration"
          />
        </HStack>
      </VStack>
    </Box>
  );
}

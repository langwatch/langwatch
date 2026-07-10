import {
  Box,
  Button,
  Field,
  HStack,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react";
import { ChevronDown, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { Menu } from "~/components/ui/menu";
import { Switch } from "~/components/ui/switch";

import { useTargetName } from "../../hooks/useTargetName";
import type {
  ComparisonEvaluatorConfig,
  TargetConfig,
} from "../../types";

type Metric = "cost" | "duration";

/**
 * Default judge prompt when Has Golden Answer is ON — mirrors the langevals
 * evaluator schema's default verbatim (including whitespace). Kept in sync
 * with DEFAULT_SELECT_BEST_PROMPT in select_best_compare.py so the auto-
 * swap equality check recognizes an untouched prompt.
 */
const GOLDEN_AWARE_JUDGE_PROMPT =
  'Pick the best of N candidate replies to the task.\n\nTask:       {input}\nReference:  {golden}\n\nCandidates:\n{candidates}\n\nLook across the candidates and decide which one is the best reply.\nBriefly explain WHY it\'s better than the others, then pick the winning\nslot label. Use "tie" only when no candidate is clearly better.\n';

/**
 * Default judge prompt when Has Golden Answer is OFF — no {golden} slot,
 * comparison is candidates on their own merits given the task. Kept in
 * sync with DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN on the Python side.
 */
const GOLDEN_FREE_JUDGE_PROMPT =
  'Pick the best of N candidate replies to the task — there is no reference\nanswer, so compare them on their own merits.\n\nTask:  {input}\n\nCandidates:\n{candidates}\n\nLook across the candidates and decide which one is the best reply.\nBriefly explain WHY it\'s better than the others, then pick the winning\nslot label. Use "tie" only when no candidate is clearly better.\n';

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
};

export function ComparisonConfigForm({
  value,
  onChange,
  targets,
  datasetColumns,
}: ComparisonConfigFormProps) {
  // Same local-draft + ref pattern PairwiseConfigForm uses so back-to-back
  // picks against a stale `value` prop don't stomp each other. Parent-
  // pushed value changes still resync `draft`.
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
      <VariantsMultiSelect
        draft={draft}
        update={update}
        targets={targets}
      />

      <GoldenAnswerSection
        draft={draft}
        update={update}
        datasetColumns={datasetColumns}
      />

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
  const add = (id: string) => update({ variants: [...selected, id] });
  const remove = (id: string) =>
    update({ variants: selected.filter((v) => v !== id) });

  const insufficient = selected.length < 2;

  return (
    <Field.Root required flex="1">
      <Field.Label fontSize="13px" color="fg.muted" marginBottom={2}>
        Variants (pick 2 or more)
      </Field.Label>
      <Wrap gap={2}>
        {selected.map((id) => {
          const target = targets.find((t) => t.id === id);
          if (!target) return null;
          return (
            <VariantChip
              key={id}
              target={target}
              onRemove={() => remove(id)}
            />
          );
        })}
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="outline"
              colorPalette="gray"
              size="sm"
              fontWeight="normal"
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
                <VariantMenuItem
                  key={t.id}
                  target={t}
                  onAdd={() => add(t.id)}
                />
              ))
            )}
          </Menu.Content>
        </Menu.Root>
      </Wrap>
      {insufficient && (
        <Text
          fontSize="xs"
          color="orange.solid"
          marginTop={2}
          data-testid="comparison-variants-insufficient"
        >
          Pick 2 or more variants.
        </Text>
      )}
    </Field.Root>
  );
}

/**
 * Menu item for a target the user can add. Split into its own component so
 * `useTargetName` runs at a stable hook position (Rules of Hooks) even as
 * the remaining-targets list shrinks with each pick. Same rationale as
 * PairwiseConfigForm's TargetNameContributor.
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
 * Chip for an already-picked variant. Shows the target's human-readable
 * name with an ✕ affordance to remove.
 */
function VariantChip({
  target,
  onRemove,
}: {
  target: TargetConfig;
  onRemove: () => void;
}) {
  const name = useTargetName(target) ?? target.id;
  return (
    <HStack
      gap={1}
      paddingLeft={2}
      paddingRight={1}
      paddingY={1}
      borderRadius="md"
      bg="purple.subtle"
      color="purple.fg"
      data-testid={`comparison-variant-chip-${target.id}`}
    >
      <Text fontSize="13px">{name}</Text>
      <Button
        variant="ghost"
        size="xs"
        minWidth="auto"
        padding={0}
        height="18px"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        data-testid={`comparison-variant-chip-${target.id}-remove`}
      >
        <X size={12} />
      </Button>
    </HStack>
  );
}

/**
 * "Has golden answer" toggle plus the Golden field picker it gates.
 * Parity with PairwiseConfigForm's #5378 opt-out: source of truth is the
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
}: {
  draft: ComparisonEvaluatorConfig;
  update: (patch: Partial<ComparisonEvaluatorConfig>) => void;
  datasetColumns: DatasetColumn[];
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

  // Keep the judge prompt in sync with has_golden_answer reactively — on
  // every change of either field, not just the toggle click — so the
  // correct prompt is enforced regardless of HOW state changed (click,
  // form init, external setValue, load from persistence). Only swap when
  // the current prompt exactly matches a shipped default so hand-tuned
  // prompts survive toggling. Same pattern PairwiseConfigForm uses.
  const isDefaultPrompt = useCallback(
    (value: string | undefined, target: string): boolean =>
      typeof value === "string" && value.trim() === target.trim(),
    [],
  );
  useEffect(() => {
    if (!formContext) return;
    if (typeof watchedHasGoldenAnswer !== "boolean") return;
    if (typeof watchedPrompt !== "string") return;
    const shouldBeGoldenAware = watchedHasGoldenAnswer !== false;
    const nextPrompt = shouldBeGoldenAware
      ? isDefaultPrompt(watchedPrompt, GOLDEN_FREE_JUDGE_PROMPT)
        ? GOLDEN_AWARE_JUDGE_PROMPT
        : null
      : isDefaultPrompt(watchedPrompt, GOLDEN_AWARE_JUDGE_PROMPT)
        ? GOLDEN_FREE_JUDGE_PROMPT
        : null;
    if (nextPrompt && nextPrompt !== watchedPrompt) {
      formContext.setValue("settings.prompt", nextPrompt, {
        shouldDirty: true,
        shouldTouch: true,
      });
    }
  }, [formContext, watchedHasGoldenAnswer, watchedPrompt, isDefaultPrompt]);

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

  return (
    <Box>
      <HStack justify="space-between" align="start">
        <HStack gap={0} align="center">
          <Text fontSize="13px" fontWeight="medium">
            Has golden answer
          </Text>
          <FieldInfoTooltip
            testId="comparison-has-golden-answer-info"
            description="Compare each candidate against a reference answer. Turn off to let the judge compare the candidates directly on their own merits, with no reference answer involved."
          />
        </HStack>
        <Switch
          checked={hasGoldenAnswer}
          onCheckedChange={({ checked }) => setHasGoldenAnswer(checked)}
          data-testid="comparison-has-golden-answer"
        />
      </HStack>

      {hasGoldenAnswer && (
        <Box paddingTop={3}>
          <Field.Root required flex="1">
            <Field.Label fontSize="13px" color="fg.muted" marginBottom={1}>
              Golden field
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
                    {draft.goldenField || "Select a dataset column…"}
                  </Text>
                  <ChevronDown
                    size={14}
                    color="var(--chakra-colors-fg-muted)"
                  />
                </Button>
              </Menu.Trigger>
              <Menu.Content
                portalled={true}
                maxHeight="240px"
                overflowY="auto"
              >
                {datasetColumns.length === 0 ? (
                  <Menu.Item value="__empty__" disabled>
                    <Text fontSize="13px" color="fg.subtle">
                      No options available
                    </Text>
                  </Menu.Item>
                ) : (
                  datasetColumns.map((c) => (
                    <Menu.Item
                      key={c.id}
                      value={c.name}
                      onClick={() => update({ goldenField: c.name })}
                      data-testid={`comparison-golden-field-option-${c.name}`}
                    >
                      <Text fontSize="13px">{c.name}</Text>
                    </Menu.Item>
                  ))
                )}
              </Menu.Content>
            </Menu.Root>
            <Text fontSize="xs" color="fg.muted" marginTop={2}>
              The dataset column that holds the ground-truth answer —
              usually{" "}
              <Text as="span" fontFamily="mono">
                expected_output
              </Text>
              . The judge compares each candidate against it and picks the
              closest.
            </Text>
          </Field.Root>
        </Box>
      )}
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
            description="Judges tend to favour whichever candidate they read first. Shuffling each row's candidates cancels that out. The same row always gets the same order, so re-running gives you comparable verdicts."
          />
        </HStack>
        <Switch
          checked={randomizeOrder}
          onCheckedChange={({ checked }) => setRandomizeOrder(checked)}
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
    (metric: Metric, on: boolean) => {
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
          Include metrics
        </Text>
        <FieldInfoTooltip
          testId="comparison-include-metrics-info"
          description="Inject per-candidate cost and latency into the judge prompt so it can prefer the cheaper or faster variant when quality is comparable."
        />
      </HStack>
      <VStack align="stretch" gap={2}>
        <HStack justify="space-between">
          <Text fontSize="13px">Include cost</Text>
          <Switch
            checked={current.includes("cost")}
            onCheckedChange={({ checked }) => toggle("cost", checked)}
            data-testid="comparison-include-cost"
          />
        </HStack>
        <HStack justify="space-between">
          <Text fontSize="13px">Include duration</Text>
          <Switch
            checked={current.includes("duration")}
            onCheckedChange={({ checked }) => toggle("duration", checked)}
            data-testid="comparison-include-duration"
          />
        </HStack>
      </VStack>
    </Box>
  );
}

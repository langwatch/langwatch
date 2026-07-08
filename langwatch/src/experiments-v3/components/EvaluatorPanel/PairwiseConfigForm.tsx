import { Box, Button, Field, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { Menu } from "~/components/ui/menu";
import { Switch } from "~/components/ui/switch";
import {
  type AvailableSource,
  type FieldMapping as UIFieldMapping,
  VariableMappingInput,
} from "~/components/variables";
import type { Field as DSLField } from "~/optimization_studio/types/dsl";

import { useTargetName } from "../../hooks/useTargetName";
import type { PairwiseEvaluatorConfig, TargetConfig } from "../../types";

type Metric = "cost" | "duration";

/**
 * Default judge prompt when Has Golden Answer is ON — mirrors the langevals
 * evaluator schema's default. Kept verbatim (including whitespace) so the
 * equality check in `setHasGoldenAnswer` recognizes an untouched prompt
 * against the exact string the evaluator ships with. Any drift here would
 * silently disable the auto-swap for users who kept the default.
 */
const GOLDEN_AWARE_JUDGE_PROMPT =
  'Compare two candidate outputs against a known-good reference (golden answer).\n\nTask:           {input}\nGolden answer:  {golden}\n\nCandidate A:    {candidate_a_output}\nCandidate B:    {candidate_b_output}\n\nReason step-by-step about how closely each candidate matches the\ngolden answer in correctness, completeness, and style. Then pick\nthe better candidate, or "tie" if equivalent.\nPrefer cheaper/faster only when quality is comparable.\n';

/**
 * Default judge prompt when Has Golden Answer is OFF — no {golden} slot,
 * comparison is A vs B on their own merits given the task. Kept in sync
 * with the langevals evaluator's `has_golden_answer=false` handling —
 * langevals just ignores {golden} in that mode, but the prompt still reads
 * as if there's a reference, which confuses the judge and biases the
 * verdict. This template drops the reference entirely.
 */
const GOLDEN_FREE_JUDGE_PROMPT =
  'Compare two candidate outputs directly, on their own merits — there is no reference answer.\n\nTask:         {input}\n\nCandidate A:  {candidate_a_output}\nCandidate B:  {candidate_b_output}\n\nReason step-by-step about which candidate better answers the task in\ncorrectness, completeness, and style. Then pick the better candidate,\nor "tie" if equivalent. Prefer cheaper/faster only when quality is\ncomparable.\n';

/**
 * Configuration form for the langevals/pairwise_compare evaluator
 * (#5100). Three required selects:
 *
 *   1. Variant A   — id of an existing TargetConfig
 *   2. Variant B   — id of a different existing TargetConfig
 *   3. Golden      — name of a dataset column whose value is the
 *                    reference answer
 *
 * Per-candidate metrics (cost / duration) are configured in the
 * settings section above via the schema-driven `include_metrics`
 * toggles — that's the single source of truth the judge prompt reads.
 *
 * Pickers use the project's Menu-button pattern (see FieldTypeSelect
 * for the canonical reference) so the drawer reads as a peer of the
 * other LangWatch surfaces instead of a browser-native control.
 *
 * Variant labels come from `useTargetName`, the same reactive hook the
 * column header uses — so the dropdown shows the prompt/agent name
 * ("say-hi"), not the internal target_NNNN id.
 */

export type DatasetColumn = { id: string; name: string };

export type PairwiseConfigFormProps = {
  value: PairwiseEvaluatorConfig;
  onChange: (next: PairwiseEvaluatorConfig) => void;
  /** All targets the user has configured (excluding evaluator-as-target). */
  targets: TargetConfig[];
  /** Active dataset columns the user can pick the golden field from. */
  datasetColumns: DatasetColumn[];
};

type PickerProps = {
  label: string;
  selectedDisplay: React.ReactNode;
  placeholder: string;
  isEmpty: boolean;
  testId?: string;
  children: React.ReactNode;
};

const Picker = ({
  label,
  selectedDisplay,
  placeholder,
  isEmpty,
  testId,
  children,
}: PickerProps) => (
  <Field.Root required flex="1">
    <Field.Label fontSize="13px" color="fg.muted" marginBottom={1}>
      {label}
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
          data-testid={testId}
        >
          <Text fontSize="13px" color={isEmpty ? "fg.subtle" : "fg"} truncate>
            {isEmpty ? placeholder : selectedDisplay}
          </Text>
          <ChevronDown size={14} color="var(--chakra-colors-fg-muted)" />
        </Button>
      </Menu.Trigger>
      <Menu.Content portalled={true} maxHeight="240px" overflowY="auto">
        {children}
      </Menu.Content>
    </Menu.Root>
  </Field.Root>
);

const EmptyMenuItem = () => (
  <Menu.Item value="__empty__" disabled>
    <Text fontSize="13px" color="fg.subtle">
      No options available
    </Text>
  </Menu.Item>
);

export function PairwiseConfigForm({
  value,
  onChange,
  targets,
  datasetColumns,
}: PairwiseConfigFormProps) {
  // Track the latest config locally so rapid successive picks (e.g. user
  // selects Variant A, then Variant B before the parent re-renders with the
  // new value prop) don't stomp on each other. Without this each `update`
  // spread off the stale `value` prop and only the last pick stuck. We sync
  // back to `value` when the parent intentionally pushes new state in.
  const [draft, setDraft] = useState<PairwiseEvaluatorConfig>(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Mirror `draft` into a ref so `update` can compute `next` from the
  // freshest value without putting a side-effect inside `setDraft`'s updater
  // function (which React 18 StrictMode invokes twice for purity checks —
  // double-firing the `onChange` callback against the parent).
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const update = (patch: Partial<PairwiseEvaluatorConfig>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    onChange(next);
  };

  // Variant B options exclude variant A so the user can't pick the same
  // target twice (a pairwise comparison of X vs X is always a tie).
  const variantBOptions = targets.filter((t) => t.id !== draft.variantA);

  return (
    // No horizontal padding here — the drawer body (EvaluatorEditorShared)
    // already applies paddingX to its content, same as the boolean settings
    // section above us. Adding our own here previously double-inset this
    // section relative to Swap And Confirm / Allow Tie / Include metrics.
    <VStack align="stretch" gap={3}>
      <VariantMappingRow
        draft={draft}
        update={update}
        targets={targets}
        variantBOptions={variantBOptions}
      />

      <GoldenAnswerSection
        draft={draft}
        update={update}
        datasetColumns={datasetColumns}
      />

      <MetricsSection draft={draft} update={update} />
    </VStack>
  );
}

/**
 * "Has golden answer" toggle (#5378) plus the Golden field picker it
 * gates. Source of truth is the parent form's `settings.has_golden_answer`
 * (the field the judge reads); `pairwise.hasGoldenAnswer` is mirrored on
 * every write so the orchestrator's cell-generation guard and the missing-
 * mappings validator — which only see `target.pairwise`, not the
 * evaluator's Python settings — can read it too. Same dual-representation
 * pattern as MetricsSection/include_metrics below.
 */
function GoldenAnswerSection({
  draft,
  update,
  datasetColumns,
}: {
  draft: PairwiseEvaluatorConfig;
  update: (patch: Partial<PairwiseEvaluatorConfig>) => void;
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

  // Keep the judge prompt in sync with the has_golden_answer toggle
  // REACTIVELY — running on every change of either field (not just on the
  // toggle click) so the correct prompt is enforced regardless of HOW the
  // state changed: click, form init from a saved config, external
  // `setValue`, or a load from persistence. Only swap when the current
  // prompt exactly matches one of our shipped defaults so hand-tuned
  // prompts survive toggling. Fuzzy-compare on trimmed strings so subtle
  // whitespace drift (Windows CRLF, editor auto-trim) doesn't break the
  // equality check.
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
    // is confusing, so we drop it when turning golden OFF).
    update({ hasGoldenAnswer: on, ...(on ? {} : { goldenField: "" }) });
  };

  return (
    <Box>
      <HStack justify="space-between" align="start">
        <VStack align="start" gap={0}>
          <Text fontSize="13px" fontWeight="medium">
            Has golden answer
          </Text>
          <Text fontSize="xs" color="fg.muted" maxWidth="480px">
            Compare each candidate against a reference answer. Turn off to let
            the judge compare Candidate A and Candidate B directly, with no
            reference answer involved.
          </Text>
        </VStack>
        <Switch
          checked={hasGoldenAnswer}
          onCheckedChange={({ checked }) => setHasGoldenAnswer(checked)}
          data-testid="pairwise-has-golden-answer"
        />
      </HStack>

      {hasGoldenAnswer && (
        <Box paddingTop={3}>
          <Picker
            label="Golden field"
            placeholder="Select a dataset column…"
            isEmpty={!draft.goldenField}
            selectedDisplay={<>{draft.goldenField}</>}
            testId="pairwise-golden-field"
          >
            {datasetColumns.length === 0 ? (
              <EmptyMenuItem />
            ) : (
              datasetColumns.map((c) => (
                <Menu.Item
                  key={c.id}
                  value={c.name}
                  onClick={() => update({ goldenField: c.name })}
                  data-testid={`pairwise-golden-field-option-${c.name}`}
                >
                  <Text fontSize="13px">{c.name}</Text>
                </Menu.Item>
              ))
            )}
          </Picker>
          <Text fontSize="xs" color="fg.muted" marginTop={2}>
            Pick the dataset column that holds the{" "}
            <Text as="span" fontWeight="medium" color="fg">
              ground-truth answer
            </Text>{" "}
            — usually{" "}
            <Text as="span" fontFamily="mono">
              expected_output
            </Text>
            . The judge compares each candidate against it and prefers the one
            closest in correctness, completeness, and style.
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Inline Switches for the include_metrics setting. Source of truth is the
 * parent form's `settings.include_metrics` (the field the judge reads); the
 * legacy `pairwise.includeMetrics` is mirrored on every write so any
 * orchestrator path still reading from it keeps working. EvaluatorEditorShared
 * suppresses DynamicZodForm's array-of-literals renderer for pairwise so the
 * user doesn't see two UIs for the same setting.
 */
function MetricsSection({
  draft,
  update,
}: {
  draft: PairwiseEvaluatorConfig;
  update: (patch: Partial<PairwiseEvaluatorConfig>) => void;
}) {
  const formContext = useFormContext<{
    settings?: { include_metrics?: Metric[] };
  }>();
  const watchedMetrics = useWatch({
    control: formContext?.control,
    name: "settings.include_metrics",
  }) as Metric[] | undefined;
  const current = (watchedMetrics ?? draft.includeMetrics ?? []) as Metric[];

  const toggle = (metric: Metric, on: boolean) => {
    const next = on
      ? Array.from(new Set([...current, metric]))
      : current.filter((m) => m !== metric);
    formContext?.setValue("settings.include_metrics", next, {
      shouldDirty: true,
      shouldTouch: true,
    });
    update({ includeMetrics: next });
  };

  return (
    <Box paddingTop={2}>
      <Text
        fontSize="11px"
        fontWeight="bold"
        textTransform="uppercase"
        letterSpacing="wide"
        color="fg.muted"
        marginBottom={2}
      >
        Include metrics
      </Text>
      <VStack align="stretch" gap={2}>
        <HStack justify="space-between">
          <Text fontSize="13px">Include cost</Text>
          <Switch
            checked={current.includes("cost")}
            onCheckedChange={({ checked }) => toggle("cost", checked)}
            data-testid="pairwise-include-cost"
          />
        </HStack>
        <HStack justify="space-between">
          <Text fontSize="13px">Include duration</Text>
          <Switch
            checked={current.includes("duration")}
            onCheckedChange={({ checked }) => toggle("duration", checked)}
            data-testid="pairwise-include-duration"
          />
        </HStack>
      </VStack>
      <Text fontSize="xs" color="fg.muted" marginTop={2}>
        Inject per-candidate cost / latency into the judge prompt so it can
        prefer the cheaper / faster variant when quality is comparable.
      </Text>
    </Box>
  );
}

/**
 * Reuse the app-wide mappings widget (`VariableMappingInput`) for both
 * Variant A and Variant B (#5100 dogfood follow-up — Rogerio).
 *
 * The bespoke Menu-based picker forced the user to reason in two steps
 * ("pick a target", "pick an output field of that target") and diverged
 * from the mappings picker's `<target>.<field>` pill shape everywhere
 * else in the app. Structured outputs also had no natural home.
 * `VariableMappingInput` handles both concerns natively via grouped
 * sources → fields dropdowns.
 *
 * Storage stays the same: `variantA` = target id, `variantAOutputPath` =
 * the selected field path. Whole-output selection stays representable as
 * an empty / omitted path so previously saved configs keep working.
 */
function VariantMappingRow({
  draft,
  update,
  targets,
  variantBOptions,
}: {
  draft: PairwiseEvaluatorConfig;
  update: (patch: Partial<PairwiseEvaluatorConfig>) => void;
  targets: TargetConfig[];
  variantBOptions: TargetConfig[];
}) {
  // A→B and B→A must reflect fresh names as targets are added / renamed;
  // the contributor pattern below lifts each target's `useTargetName`
  // result into a plain map so the two mapping pickers can render a stable
  // AvailableSource[] without violating hooks rules over a dynamic array.
  const [nameById, setNameById] = useState<Record<string, string>>({});
  const setName = useCallback((id: string, name: string) => {
    setNameById((prev) => (prev[id] === name ? prev : { ...prev, [id]: name }));
  }, []);

  const sourcesForVariantA = useMemo(
    () => targets.map((t) => targetToSource(t, nameById[t.id] ?? t.id)),
    [targets, nameById],
  );
  const sourcesForVariantB = useMemo(
    () => variantBOptions.map((t) => targetToSource(t, nameById[t.id] ?? t.id)),
    [variantBOptions, nameById],
  );

  return (
    <VStack align="stretch" gap={3}>
      <HStack align="end" gap={3}>
        <Field.Root required flex="1">
          <Field.Label fontSize="13px" color="fg.muted" marginBottom={1}>
            Variant A
          </Field.Label>
          <VariableMappingInput
            mapping={buildUIMapping(draft.variantA, draft.variantAOutputPath)}
            onMappingChange={(mapping) =>
              update(mappingToVariantPatch(mapping, "A"))
            }
            availableSources={sourcesForVariantA}
            placeholder="Select a target field"
            inputTestId="pairwise-variant-a"
          />
        </Field.Root>
        <Field.Root required flex="1">
          <Field.Label fontSize="13px" color="fg.muted" marginBottom={1}>
            Variant B
          </Field.Label>
          <VariableMappingInput
            mapping={buildUIMapping(draft.variantB, draft.variantBOutputPath)}
            onMappingChange={(mapping) =>
              update(mappingToVariantPatch(mapping, "B"))
            }
            availableSources={sourcesForVariantB}
            placeholder="Select a target field"
            inputTestId="pairwise-variant-b"
          />
        </Field.Root>
      </HStack>
      {targets.map((t) => (
        <TargetNameContributor key={t.id} target={t} onName={setName} />
      ))}
    </VStack>
  );
}

/**
 * Non-rendering hook consumer: resolves this target's display name via
 * `useTargetName` and reports it up to the parent. Split into its own
 * component so `useTargetName` (which needs a concrete target) is called
 * at a stable hook position even as the targets list grows / shrinks.
 */
function TargetNameContributor({
  target,
  onName,
}: {
  target: TargetConfig;
  onName: (id: string, name: string) => void;
}) {
  const name = useTargetName(target);
  useEffect(() => {
    if (name) onName(target.id, name);
  }, [name, target.id, onName]);
  return null;
}

const targetToSource = (
  target: TargetConfig,
  displayName: string,
): AvailableSource => ({
  id: target.id,
  name: displayName,
  // "signature" matches the source type the evaluator mappings drawer uses
  // for its target source (see useOpenEvaluatorEditor) — same widget, same
  // icon, same tree shape.
  type: "signature",
  fields: (target.outputs ?? []).map((o) => ({
    name: o.identifier,
    type: o.type as DSLField["type"],
  })),
});

const buildUIMapping = (
  variantId: string | undefined,
  path: string[] | undefined,
): UIFieldMapping | undefined => {
  if (!variantId) return undefined;
  return { type: "source", sourceId: variantId, path: path ?? [] };
};

const mappingToVariantPatch = (
  mapping: UIFieldMapping | undefined,
  slot: "A" | "B",
): Partial<PairwiseEvaluatorConfig> => {
  if (!mapping || mapping.type !== "source") {
    // Clearing / a stray hardcoded-value mapping both reset to unset.
    return slot === "A"
      ? { variantA: "", variantAOutputPath: undefined }
      : { variantB: "", variantBOutputPath: undefined };
  }
  const patch: Partial<PairwiseEvaluatorConfig> =
    slot === "A"
      ? {
          variantA: mapping.sourceId,
          variantAOutputPath:
            mapping.path.length > 0 ? mapping.path : undefined,
        }
      : {
          variantB: mapping.sourceId,
          variantBOutputPath:
            mapping.path.length > 0 ? mapping.path : undefined,
        };
  return patch;
};

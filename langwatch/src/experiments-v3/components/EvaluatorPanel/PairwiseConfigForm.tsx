import { Box, Button, Field, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { Menu } from "~/components/ui/menu";
import { Switch } from "~/components/ui/switch";

import { useTargetName } from "../../hooks/useTargetName";
import type { PairwiseEvaluatorConfig, TargetConfig } from "../../types";

type Metric = "cost" | "duration";

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

/**
 * One row inside a Variant A/B menu. Lives in its own component so each
 * row owns its own `useTargetName` hook call — calling the hook inside
 * a .map() over `targets` would break the rules of hooks when the list
 * grows or shrinks between renders.
 */
const VariantMenuItem = ({
  target,
  onSelect,
  testId,
}: {
  target: TargetConfig;
  onSelect: (id: string) => void;
  testId?: string;
}) => {
  const name = useTargetName(target);
  const label = name || target.id;
  return (
    <Menu.Item
      value={target.id}
      onClick={() => onSelect(target.id)}
      data-testid={testId}
    >
      <Text fontSize="13px">{label}</Text>
    </Menu.Item>
  );
};

/**
 * Inline label for the selected variant inside the picker trigger. Same
 * reactive name resolution as VariantMenuItem.
 */
const SelectedVariantLabel = ({ target }: { target: TargetConfig }) => {
  const name = useTargetName(target);
  return <>{name || target.id}</>;
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

  const selectedA = targets.find((t) => t.id === draft.variantA);
  const selectedB = targets.find((t) => t.id === draft.variantB);

  return (
    // No horizontal padding here — the drawer body (EvaluatorEditorShared)
    // already applies paddingX to its content, same as the boolean settings
    // section above us. Adding our own here previously double-inset this
    // section relative to Swap And Confirm / Allow Tie / Include metrics.
    <VStack align="stretch" gap={3}>
      <HStack align="end" gap={3}>
        <Picker
          label="Variant A"
          placeholder="Select a target…"
          isEmpty={!selectedA}
          selectedDisplay={
            selectedA ? <SelectedVariantLabel target={selectedA} /> : null
          }
          testId="pairwise-variant-a"
        >
          {targets.length === 0 ? (
            <EmptyMenuItem />
          ) : (
            targets.map((t) => (
              <VariantMenuItem
                key={t.id}
                target={t}
                // Reset the output-field path whenever the variant changes —
                // a stale path from the previous variant would silently
                // point at a field that doesn't exist on the new one, and
                // the orchestrator would ship `undefined` to the judge.
                onSelect={(id) =>
                  update({ variantA: id, variantAOutputPath: undefined })
                }
                testId={`pairwise-variant-a-option-${t.id}`}
              />
            ))
          )}
        </Picker>

        <Picker
          label="Variant B"
          placeholder="Select a target…"
          isEmpty={!selectedB}
          selectedDisplay={
            selectedB ? <SelectedVariantLabel target={selectedB} /> : null
          }
          testId="pairwise-variant-b"
        >
          {variantBOptions.length === 0 ? (
            <EmptyMenuItem />
          ) : (
            variantBOptions.map((t) => (
              <VariantMenuItem
                key={t.id}
                target={t}
                onSelect={(id) =>
                  update({ variantB: id, variantBOutputPath: undefined })
                }
                testId={`pairwise-variant-b-option-${t.id}`}
              />
            ))
          )}
        </Picker>
      </HStack>

      {/* Structured-output narrowing: when a picked variant emits more than
          one output field, let the user pick a single field so the judge
          sees just that value instead of the whole JSON object. Empty
          selection ("use whole output") is preserved as a first option. */}
      <VariantOutputFieldRow
        selectedA={selectedA}
        selectedB={selectedB}
        pathA={draft.variantAOutputPath}
        pathB={draft.variantBOutputPath}
        onChangeA={(path) => update({ variantAOutputPath: path })}
        onChangeB={(path) => update({ variantBOutputPath: path })}
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
    settings?: { has_golden_answer?: boolean };
  }>();
  const watchedHasGoldenAnswer = useWatch({
    control: formContext?.control,
    name: "settings.has_golden_answer",
  }) as boolean | undefined;
  const hasGoldenAnswer =
    (watchedHasGoldenAnswer ?? draft.hasGoldenAnswer) !== false;

  const setHasGoldenAnswer = (on: boolean) => {
    formContext?.setValue("settings.has_golden_answer", on, {
      shouldDirty: true,
      shouldTouch: true,
    });
    // Clearing goldenField when turning the toggle off isn't strictly
    // necessary (an unused golden field is harmless), but it avoids a
    // stale selection resurfacing confusingly if the user toggles back on.
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
 * Per-variant "Output field" pickers, side-by-side and only rendered when
 * at least one selected variant has more than one output field. Empty
 * selection means "use whole output" and is the pre-existing behavior
 * (the orchestrator's `pickOutputPath` treats an empty path as no-op).
 *
 * We deliberately only surface this when there's a real choice — showing
 * a single-option picker for a target with one output field would just
 * add noise. If neither variant has more than one output field, the row
 * hides entirely.
 */
function VariantOutputFieldRow({
  selectedA,
  selectedB,
  pathA,
  pathB,
  onChangeA,
  onChangeB,
}: {
  selectedA: TargetConfig | undefined;
  selectedB: TargetConfig | undefined;
  pathA: string[] | undefined;
  pathB: string[] | undefined;
  onChangeA: (path: string[] | undefined) => void;
  onChangeB: (path: string[] | undefined) => void;
}) {
  const outputsA = selectedA?.outputs ?? [];
  const outputsB = selectedB?.outputs ?? [];
  if (outputsA.length < 2 && outputsB.length < 2) return null;
  return (
    <HStack align="end" gap={3}>
      <OutputFieldPicker
        label="Output field (A)"
        outputs={outputsA}
        value={pathA}
        onChange={onChangeA}
        testId="pairwise-variant-a-output-field"
      />
      <OutputFieldPicker
        label="Output field (B)"
        outputs={outputsB}
        value={pathB}
        onChange={onChangeB}
        testId="pairwise-variant-b-output-field"
      />
    </HStack>
  );
}

function OutputFieldPicker({
  label,
  outputs,
  value,
  onChange,
  testId,
}: {
  label: string;
  outputs: { identifier: string }[];
  value: string[] | undefined;
  onChange: (path: string[] | undefined) => void;
  testId: string;
}) {
  const selected = value && value.length > 0 ? value[0] : undefined;
  const isEmpty = !selected;
  const noChoice = outputs.length < 2;
  return (
    <Picker
      label={label}
      placeholder={noChoice ? "Whole output (default)" : "Whole output"}
      isEmpty={isEmpty}
      selectedDisplay={selected}
      testId={testId}
    >
      <Menu.Item
        value="__whole__"
        onClick={() => onChange(undefined)}
        data-testid={`${testId}-option-whole`}
      >
        <Text fontSize="13px" color="fg.muted">
          Whole output
        </Text>
      </Menu.Item>
      {outputs.map((o) => (
        <Menu.Item
          key={o.identifier}
          value={o.identifier}
          onClick={() => onChange([o.identifier])}
          data-testid={`${testId}-option-${o.identifier}`}
        >
          <Text fontSize="13px">{o.identifier}</Text>
        </Menu.Item>
      ))}
    </Picker>
  );
}

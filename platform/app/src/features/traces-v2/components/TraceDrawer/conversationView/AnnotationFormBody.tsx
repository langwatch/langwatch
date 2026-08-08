import {
  Box,
  Button,
  HStack,
  Icon,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import type { AnnotationScoreDataType } from "@prisma/client";
import { diffWordsWithSpace } from "diff";
import { Check, MessageSquareText, RotateCcw, Trash2 } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Popover } from "~/components/ui/popover";
import { toaster } from "~/components/ui/toaster";
import { useAnnotationInvalidation } from "~/hooks/useAnnotationInvalidation";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

type AnnotationScoreList = RouterOutputs["annotationScore"]["getAllActive"];
type TraceAnnotation = RouterOutputs["annotation"]["getByTraceId"][number];

/** Rating a turn versus correcting its output. */
export type AnnotationMode = "annotate" | "suggest";

interface ScoreValue {
  value: string | string[];
  reason?: string;
}

export type ScoreOptions = Record<string, ScoreValue>;

interface AnnotationScoreOption {
  label: string;
  value: number | string;
}

/** What the reviewer typed, before it becomes an annotation. */
export interface AnnotationDraftValues {
  comment: string;
  expectedOutput: string;
  scoreOptions: ScoreOptions;
}

/**
 * Everything the form body renders from and writes to. A host owns the draft
 * values however it likes (popover-local state, a store) and hands the body
 * this one shape.
 */
export interface AnnotationFormState {
  comment: string;
  setComment: (v: string) => void;
  expectedOutput: string;
  setExpectedOutput: (v: string) => void;
  scoreOptions: ScoreOptions;
  setScoreOptions: React.Dispatch<React.SetStateAction<ScoreOptions>>;
  scores: { data: AnnotationScoreList | undefined; isLoading: boolean };
  isEdit: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  hasExisting: boolean;
  handleSave: () => void;
  handleDelete: () => void;
  onCancel: () => void;
  mode: AnnotationMode;
}

/** The server half of an annotation form, independent of where it renders. */
export interface AnnotationMutations {
  existing: TraceAnnotation | undefined;
  isEdit: boolean;
  hasExisting: boolean;
  scores: { data: AnnotationScoreList | undefined; isLoading: boolean };
  isSaving: boolean;
  isDeleting: boolean;
  save: (values: AnnotationDraftValues) => void;
  remove: () => void;
}

/**
 * Reads and writes for one turn's annotation: the annotation being edited,
 * the project's active score keys, and the create / update / delete calls
 * with their toasts and cache invalidation.
 *
 * `enabled` gates the reads, so a host that keeps the form mounted while it is
 * closed pays nothing for it. `onDone` fires after a successful write.
 */
export function useAnnotationMutations({
  traceId,
  mode,
  annotationId,
  enabled,
  onDone,
}: {
  traceId: string;
  mode: AnnotationMode;
  annotationId?: string;
  enabled: boolean;
  onDone: () => void;
}): AnnotationMutations {
  const { project } = useOrganizationTeamProject();
  const invalidateTraceReads = useAnnotationInvalidation({ traceId });

  const annotationsForTrace = api.annotation.getByTraceId.useQuery(
    { projectId: project?.id ?? "", traceId },
    { enabled: !!project?.id && enabled },
  );

  const existing = useMemo(
    () => annotationsForTrace.data?.find((a) => a.id === annotationId),
    [annotationsForTrace.data, annotationId],
  );

  const isEdit = !!annotationId;

  const scores = api.annotationScore.getAllActive.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && enabled },
  );

  const create = api.annotation.create.useMutation();
  const update = api.annotation.updateByTraceId.useMutation();
  const remove = api.annotation.deleteById.useMutation();

  const save = (values: AnnotationDraftValues) => {
    if (!project?.id) return;
    const payload = {
      projectId: project.id,
      traceId,
      comment: values.comment,
      scoreOptions: stripUnratedScores(values.scoreOptions),
      expectedOutput: mode === "suggest" ? values.expectedOutput : undefined,
    };
    const onSuccess = () => {
      invalidateTraceReads();
      toaster.create({
        title: isEdit ? "Annotation updated" : "Annotation saved",
        type: "success",
      });
      onDone();
    };
    const onError = () => {
      toaster.create({
        title: "Could not save annotation",
        type: "error",
      });
    };
    if (isEdit && existing) {
      update.mutate({ ...payload, id: existing.id }, { onSuccess, onError });
    } else {
      create.mutate(payload, { onSuccess, onError });
    }
  };

  const removeExisting = () => {
    if (!project?.id || !existing) return;
    remove.mutate(
      { projectId: project.id, annotationId: existing.id },
      {
        onSuccess: () => {
          invalidateTraceReads();
          toaster.create({ title: "Annotation deleted", type: "success" });
          onDone();
        },
        onError: () => {
          toaster.create({
            title: "Could not delete annotation",
            type: "error",
          });
        },
      },
    );
  };

  return {
    existing,
    isEdit,
    hasExisting: !!existing,
    scores,
    isSaving: create.isLoading || update.isLoading,
    isDeleting: remove.isLoading,
    save,
    remove: removeExisting,
  };
}

/**
 * Only the score keys the reviewer actually rated. A key they opened and left
 * blank is not a rating, and storing it would show up as an empty score on the
 * annotation.
 */
function stripUnratedScores(scoreOptions: ScoreOptions): ScoreOptions {
  return Object.fromEntries(
    Object.entries(scoreOptions).filter(([, v]) => {
      if (v.value === "" || v.value == null) return false;
      if (Array.isArray(v.value) && v.value.length === 0) return false;
      return true;
    }),
  );
}

/** What a popover host tells the form about the turn it is annotating. */
export interface PopoverAnnotationFormInput {
  traceId: string;
  /** Current trace output. Pre-filled into the suggest field. */
  output?: string | null;
  mode: AnnotationMode;
  /** When set, opens in edit mode for this annotation. */
  annotationId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * What a form starts out holding. Editing an annotation reads its stored
 * values; a new one starts blank, except that suggesting pre-fills the trace's
 * current output so the reviewer corrects it in place.
 */
function seedDraftValues({
  existing,
  mode,
  output,
}: {
  existing: TraceAnnotation | undefined;
  mode: AnnotationMode;
  output?: string | null;
}): AnnotationDraftValues {
  if (existing) {
    return {
      comment: existing.comment ?? "",
      expectedOutput: existing.expectedOutput ?? "",
      scoreOptions: (existing.scoreOptions as unknown as ScoreOptions) ?? {},
    };
  }
  return {
    comment: "",
    expectedOutput: mode === "suggest" ? (output ?? "") : "",
    scoreOptions: {},
  };
}

/**
 * Popover-flavoured form state: draft values live in local state and are
 * seeded each time the popover opens, on top of the shared server half.
 */
export function usePopoverAnnotationForm(
  props: PopoverAnnotationFormInput,
): AnnotationFormState {
  const mutations = useAnnotationMutations({
    traceId: props.traceId,
    mode: props.mode,
    annotationId: props.annotationId,
    enabled: props.open,
    onDone: () => props.onOpenChange(false),
  });
  const { isEdit, existing } = mutations;

  const [comment, setComment] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [scoreOptions, setScoreOptions] = useState<ScoreOptions>({});

  // Seed local form state when the popover opens.
  useEffect(() => {
    if (!props.open) return;
    const seed = seedDraftValues({
      existing: isEdit ? existing : undefined,
      mode: props.mode,
      output: props.output,
    });
    setComment(seed.comment);
    setExpectedOutput(seed.expectedOutput);
    setScoreOptions(seed.scoreOptions);
  }, [props.open, isEdit, existing, props.mode, props.output]);

  return {
    comment,
    setComment,
    expectedOutput,
    setExpectedOutput,
    scoreOptions,
    setScoreOptions,
    scores: mutations.scores,
    isEdit,
    isSaving: mutations.isSaving,
    isDeleting: mutations.isDeleting,
    hasExisting: mutations.hasExisting,
    handleSave: () => mutations.save({ comment, expectedOutput, scoreOptions }),
    handleDelete: mutations.remove,
    onCancel: () => props.onOpenChange(false),
    mode: props.mode,
  };
}

export function AnnotateBody({ state }: { state: AnnotationFormState }) {
  return (
    <VStack align="stretch" gap={3}>
      <HStack>
        <Text textStyle="sm" fontWeight="600">
          {state.isEdit ? "Edit annotation" : "Add annotation"}
        </Text>
        <Spacer />
        {state.isEdit && state.hasExisting && (
          <Button
            size="2xs"
            variant="ghost"
            color="red.fg"
            onClick={state.handleDelete}
            loading={state.isDeleting}
            aria-label="Delete annotation"
          >
            <Icon as={Trash2} boxSize={3} />
          </Button>
        )}
      </HStack>

      <CommentField
        value={state.comment}
        onChange={state.setComment}
        autoFocus
      />

      <ScoreFields state={state} />
    </VStack>
  );
}

/**
 * Suggest layout uses fixed heights for both the textarea and the diff
 * panel, so the popover never resizes as the user types: no jumping, no
 * fight between edit and diff for vertical space.
 */
export function SuggestBody({
  state,
  originalOutput,
}: {
  state: AnnotationFormState;
  originalOutput: string;
}) {
  return (
    <VStack align="stretch" gap={3}>
      <HStack>
        <Text textStyle="sm" fontWeight="600">
          {state.isEdit ? "Edit suggestion" : "Suggest correction"}
        </Text>
        <Spacer />
        {originalOutput !== state.expectedOutput && (
          <Button
            size="2xs"
            variant="ghost"
            color="fg.muted"
            onClick={() => state.setExpectedOutput(originalOutput)}
          >
            <Icon as={RotateCcw} boxSize={3} />
            Reset
          </Button>
        )}
        {state.isEdit && state.hasExisting && (
          <Button
            size="2xs"
            variant="ghost"
            color="red.fg"
            onClick={state.handleDelete}
            loading={state.isDeleting}
            aria-label="Delete annotation"
          >
            <Icon as={Trash2} boxSize={3} />
          </Button>
        )}
      </HStack>

      <SectionLabel>Expected output</SectionLabel>
      <Textarea
        value={state.expectedOutput}
        onChange={(e) => state.setExpectedOutput(e.target.value)}
        placeholder="What should the output have been?"
        // Fixed height, locked to a stable size so the popover never
        // grows or jumps based on the user's edit. Internal scroll instead.
        height="180px"
        minHeight="180px"
        maxHeight="180px"
        resize="none"
        fontSize="sm"
        lineHeight="1.6"
        autoFocus
      />

      <SectionLabel>
        <HStack gap={2}>
          <Text
            textStyle="2xs"
            color="fg.muted"
            fontWeight="600"
            textTransform="uppercase"
            letterSpacing="0.06em"
          >
            Diff
          </Text>
          <Spacer />
          <DiffCounts original={originalOutput} edited={state.expectedOutput} />
        </HStack>
      </SectionLabel>
      <DiffPanel original={originalOutput} edited={state.expectedOutput} />

      <CommentField value={state.comment} onChange={state.setComment} />

      <ScoreFields state={state} />
    </VStack>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  if (typeof children === "string") {
    return (
      <Text
        textStyle="2xs"
        color="fg.muted"
        fontWeight="600"
        textTransform="uppercase"
        letterSpacing="0.06em"
      >
        {children}
      </Text>
    );
  }
  return <>{children}</>;
}

function CommentField({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <VStack align="stretch" gap={1.5}>
      <SectionLabel>Comment</SectionLabel>
      <Textarea
        size="sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional"
        // Fixed height so adding multi-line comments doesn't push the diff
        // off-screen and start a layout cascade inside the popover.
        height="64px"
        minHeight="64px"
        maxHeight="64px"
        resize="none"
        autoFocus={autoFocus}
      />
    </VStack>
  );
}

function ScoreFields({ state }: { state: AnnotationFormState }) {
  if (!state.scores.data || state.scores.data.length === 0) return null;
  return (
    <VStack align="stretch" gap={1.5}>
      <SectionLabel>Scores</SectionLabel>
      <HStack gap={1.5} wrap="wrap">
        {state.scores.data.map((s) => (
          <ScoreChip
            key={s.id}
            name={s.name}
            description={s.description}
            dataType={s.dataType!}
            options={(s.options as unknown as AnnotationScoreOption[]) ?? []}
            value={state.scoreOptions[s.id]?.value}
            reason={state.scoreOptions[s.id]?.reason ?? ""}
            onChange={(value, reason) =>
              state.setScoreOptions((prev) => ({
                ...prev,
                [s.id]: { value, reason: reason ?? prev[s.id]?.reason ?? "" },
              }))
            }
          />
        ))}
      </HStack>
    </VStack>
  );
}

/**
 * Cancel and Save, pinned under the scrolling form. Inside it, they would be a
 * Save button the reviewer has to go looking for whenever the popover opened
 * with less room than the form wants.
 */
export function FormFooter({
  state,
  padding,
}: {
  state: AnnotationFormState;
  padding: number;
}) {
  return (
    <HStack
      width="full"
      flexShrink={0}
      paddingX={padding}
      paddingBottom={padding}
      // The form's own bottom padding sits above this, inside the scroll area,
      // so the gap reads the same whether the form scrolls or not.
      paddingTop={0}
    >
      <Spacer />
      <Button size="xs" variant="ghost" onClick={state.onCancel}>
        Cancel
      </Button>
      <Button
        size="xs"
        colorPalette="blue"
        onClick={state.handleSave}
        loading={state.isSaving}
      >
        {state.isEdit ? "Update" : "Save"}
      </Button>
    </HStack>
  );
}

export interface ScoreChipProps {
  name: string;
  description?: string | null;
  dataType: AnnotationScoreDataType;
  options: AnnotationScoreOption[];
  value: string | string[] | undefined;
  reason: string;
  onChange: (value: string | string[], reason?: string) => void;
}

/** How a rating reads on the chip itself, or nothing when there is none. */
function describeScoreValue(
  value: string | string[] | undefined,
): string | null {
  if (value == null || value === "") return null;
  if (!Array.isArray(value)) return String(value);
  const [first] = value;
  if (first === undefined) return null;
  return value.length === 1 ? first : `${value.length} selected`;
}

/**
 * The rating that picking an option leaves behind. A multi-value key collects
 * a set, so picking toggles membership; a single-value key holds one option,
 * so picking the one already held clears it.
 */
function nextScoreValue({
  current,
  optValue,
  isMulti,
}: {
  current: string | string[] | undefined;
  optValue: string;
  isMulti: boolean;
}): string | string[] {
  if (!isMulti) return optValue === current ? "" : optValue;
  const selected = Array.isArray(current)
    ? current
    : current
      ? [String(current)]
      : [];
  return selected.includes(optValue)
    ? selected.filter((v) => v !== optValue)
    : [...selected, optValue];
}

/**
 * One score key as a chip + popover picker. Multi-value (CHECKBOX) keys
 * collect a set; single-value keys are toggle buttons. Optional reason
 * textarea sits below the options so reviewers can capture *why* in the
 * same flow as the rating itself.
 */
export function ScoreChip({
  name,
  description,
  dataType,
  options,
  value,
  reason,
  onChange,
}: ScoreChipProps) {
  const isMulti = dataType === "CHECKBOX";
  const [open, setOpen] = useState(false);
  const [draftReason, setDraftReason] = useState(reason);

  useEffect(() => {
    if (open) setDraftReason(reason);
  }, [open, reason]);

  const display = useMemo(() => describeScoreValue(value), [value]);

  const toggle = (optValue: string) => {
    const next = nextScoreValue({ current: value, optValue, isMulti });
    onChange(next, draftReason);
    // Single-select keys close the popover on pick: there is nothing more to
    // do unless the reviewer wants to add a reason, which re-opening the chip
    // gets them back to.
    if (typeof next === "string" && next !== "") setOpen(false);
  };

  const isSelected = (optValue: string) => {
    if (isMulti && Array.isArray(value)) return value.includes(optValue);
    return value === optValue;
  };

  // Only fire onChange when the reason actually changed, which saves a no-op
  // mutation in the quick-rate path each time the popover closes.
  const commitReason = () => {
    if (draftReason !== reason) onChange(value ?? "", draftReason);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (!e.open) commitReason();
      }}
      // Multiple of these popovers can render per annotation form (one
      // per score field). Drop them from DOM when closed so the form
      // stays cheap to keep mounted.
      lazyMount
      unmountOnExit
      positioning={{ placement: "bottom-start" }}
    >
      <ScoreChipTrigger name={name} display={display} hasReason={!!reason} />
      <Popover.Content
        width="240px"
        bg="bg.panel/92"
        onClick={(e) => e.stopPropagation()}
      >
        <Popover.Body padding={3}>
          <VStack align="stretch" gap={2}>
            {description && (
              <Text textStyle="2xs" color="fg.muted">
                {description}
              </Text>
            )}
            <ScoreOptionList
              options={options}
              isSelected={isSelected}
              onPick={toggle}
            />
            <Box height="1px" bg="border.muted" />
            <Textarea
              size="sm"
              value={draftReason}
              onChange={(e) => setDraftReason(e.target.value)}
              placeholder="Reason (optional)"
              rows={2}
              fontSize="xs"
              resize="none"
            />
            {value && (
              <Button
                size="2xs"
                variant="ghost"
                color="fg.muted"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(isMulti ? [] : "", "");
                  setDraftReason("");
                }}
              >
                Clear
              </Button>
            )}
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

/** The chip itself: the key's name, the rating on it, and whether it carries a reason. */
function ScoreChipTrigger({
  name,
  display,
  hasReason,
}: {
  name: string;
  display: string | null;
  hasReason: boolean;
}) {
  return (
    <Popover.Trigger asChild>
      <Button
        size="2xs"
        variant={display ? "solid" : "outline"}
        colorPalette={display ? "blue" : "gray"}
        paddingX={2}
        onClick={(e) => e.stopPropagation()}
      >
        <Text textStyle="2xs" fontWeight="500">
          {name}
          {display ? `: ${display}` : ""}
        </Text>
        {hasReason && (
          <Icon as={MessageSquareText} boxSize={2.5} marginLeft={1} />
        )}
      </Button>
    </Popover.Trigger>
  );
}

/** The key's options, with the ones the reviewer picked marked as chosen. */
function ScoreOptionList({
  options,
  isSelected,
  onPick,
}: {
  options: AnnotationScoreOption[];
  isSelected: (optValue: string) => boolean;
  onPick: (optValue: string) => void;
}) {
  return (
    <VStack align="stretch" gap={0.5}>
      {options.map((opt) => {
        const optValue = String(opt.value);
        const selected = isSelected(optValue);
        return (
          <Button
            key={optValue}
            size="xs"
            variant={selected ? "solid" : "ghost"}
            colorPalette={selected ? "blue" : "gray"}
            justifyContent="flex-start"
            onClick={(e) => {
              e.stopPropagation();
              onPick(optValue);
            }}
          >
            <Box width="14px">
              {selected && <Icon as={Check} boxSize={3} />}
            </Box>
            <Text textStyle="xs">{opt.label}</Text>
          </Button>
        );
      })}
    </VStack>
  );
}

function DiffCounts({
  original,
  edited,
}: {
  original: string;
  edited: string;
}) {
  const deferredEdited = useDeferredValue(edited);
  const counts = useMemo(() => {
    const parts = diffWordsWithSpace(original, deferredEdited);
    const added = parts
      .filter((p) => p.added)
      .reduce((acc, p) => acc + p.value.length, 0);
    const removed = parts
      .filter((p) => p.removed)
      .reduce((acc, p) => acc + p.value.length, 0);
    return { added, removed };
  }, [original, deferredEdited]);

  if (counts.added === 0 && counts.removed === 0) {
    return (
      <Text textStyle="2xs" color="fg.subtle">
        no changes
      </Text>
    );
  }

  return (
    <HStack gap={2}>
      <Text textStyle="2xs" color="green.fg">
        +{counts.added}
      </Text>
      <Text textStyle="2xs" color="red.fg">
        −{counts.removed}
      </Text>
    </HStack>
  );
}

/**
 * Read-only word-level diff. Fixed height with internal scroll: the
 * panel size is locked so the popover doesn't resize as the user types.
 * `useDeferredValue` keeps typing snappy by recomputing the diff at idle.
 */
function DiffPanel({ original, edited }: { original: string; edited: string }) {
  const deferredEdited = useDeferredValue(edited);
  const parts = useMemo(
    () => diffWordsWithSpace(original, deferredEdited),
    [original, deferredEdited],
  );
  const hasChanges = parts.some((p) => p.added || p.removed);

  return (
    <Box
      height="160px"
      minHeight="160px"
      maxHeight="160px"
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
      paddingX={3}
      paddingY={2.5}
      overflowY="auto"
      overflowX="hidden"
      fontSize="xs"
      lineHeight="1.6"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
    >
      {hasChanges ? (
        parts.map((part, i) => {
          if (part.added) {
            return (
              <Box
                key={i}
                as="span"
                bg="green.subtle"
                color="green.fg"
                borderRadius="2px"
              >
                {part.value}
              </Box>
            );
          }
          if (part.removed) {
            return (
              <Box
                key={i}
                as="span"
                bg="red.subtle"
                color="red.fg"
                textDecoration="line-through"
                borderRadius="2px"
              >
                {part.value}
              </Box>
            );
          }
          return (
            <Box key={i} as="span" color="fg.muted">
              {part.value}
            </Box>
          );
        })
      ) : (
        <Text textStyle="xs" color="fg.subtle" fontStyle="italic">
          Edit the field above to see what changed.
        </Text>
      )}
    </Box>
  );
}

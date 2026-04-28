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
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type Mode = "annotate" | "suggest";

interface AnnotationPopoverProps {
  traceId: string;
  /** Current trace output. Pre-filled into the suggest field. */
  output?: string | null;
  mode: Mode;
  /** When set, opens in edit mode for this annotation. */
  annotationId?: string;
  /** The button that opens the popover. */
  trigger: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ScoreValue {
  value: string | string[];
  reason?: string;
}

type ScoreOptions = Record<string, ScoreValue>;

interface AnnotationScoreOption {
  label: string;
  value: number | string;
}

/**
 * Both annotate and suggest live in popovers anchored to the trigger.
 * Suggest is wider and uses a fixed-height layout so the popover doesn't
 * resize as the user types — the diff panel scrolls internally rather than
 * pushing the textarea around.
 */
export function AnnotationPopover(props: AnnotationPopoverProps) {
  const formState = useAnnotationForm(props);
  const isSuggest = props.mode === "suggest";

  return (
    <Popover.Root
      open={props.open}
      onOpenChange={(e) => props.onOpenChange(e.open)}
      positioning={{
        placement: "bottom-end",
        // Flip & shift so the popover stays inside the viewport instead of
        // being clipped when opened near an edge. Cuts the "popover gets
        // squeezed and chops off the bottom" failure mode.
        flip: true,
        shift: { padding: 16 },
        overflowPadding: 16,
      }}
    >
      <Popover.Trigger asChild>{props.trigger}</Popover.Trigger>
      <Popover.Content
        width={isSuggest ? "560px" : "380px"}
        // When the viewport really can't fit the popover, scroll inside
        // rather than letting the positioner shrink and clip content.
        maxHeight="min(640px, calc(100vh - 32px))"
        overflowY="auto"
        overflowX="hidden"
        onClick={(e) => e.stopPropagation()}
        bg="bg.panel/92"
      >
        <Popover.Arrow />
        <Popover.Body padding={isSuggest ? 4 : 3}>
          {isSuggest ? (
            <SuggestBody
              state={formState}
              originalOutput={props.output ?? ""}
            />
          ) : (
            <AnnotateBody state={formState} />
          )}
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

interface AnnotationFormState {
  comment: string;
  setComment: (v: string) => void;
  expectedOutput: string;
  setExpectedOutput: (v: string) => void;
  scoreOptions: ScoreOptions;
  setScoreOptions: React.Dispatch<React.SetStateAction<ScoreOptions>>;
  scores: ReturnType<typeof api.annotationScore.getAllActive.useQuery>;
  isEdit: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  hasExisting: boolean;
  handleSave: () => void;
  handleDelete: () => void;
  onCancel: () => void;
  mode: Mode;
}

function useAnnotationForm(
  props: AnnotationPopoverProps,
): AnnotationFormState {
  const { project } = useOrganizationTeamProject();
  const trpc = api.useContext();

  const annotationsForTrace = api.annotation.getByTraceId.useQuery(
    { projectId: project?.id ?? "", traceId: props.traceId },
    { enabled: !!project?.id && props.open },
  );

  const existing = useMemo(
    () =>
      annotationsForTrace.data?.find((a) => a.id === props.annotationId),
    [annotationsForTrace.data, props.annotationId],
  );

  const isEdit = !!props.annotationId;

  const scores = api.annotationScore.getAllActive.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && props.open },
  );

  const [comment, setComment] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [scoreOptions, setScoreOptions] = useState<ScoreOptions>({});

  // Seed local form state when the popover opens. Edit-mode reads from the
  // existing annotation; new-mode pre-fills suggest with the trace's
  // current output so the user edits in place.
  useEffect(() => {
    if (!props.open) return;
    if (isEdit && existing) {
      setComment(existing.comment ?? "");
      setExpectedOutput(existing.expectedOutput ?? "");
      setScoreOptions((existing.scoreOptions as ScoreOptions) ?? {});
    } else {
      setComment("");
      setExpectedOutput(
        props.mode === "suggest" ? (props.output ?? "") : "",
      );
      setScoreOptions({});
    }
  }, [props.open, isEdit, existing, props.mode, props.output]);

  const create = api.annotation.create.useMutation();
  const update = api.annotation.updateByTraceId.useMutation();
  const remove = api.annotation.deleteById.useMutation();

  const handleSave = () => {
    if (!project?.id) return;
    const cleanScores = Object.fromEntries(
      Object.entries(scoreOptions).filter(([, v]) => {
        if (v.value === "" || v.value == null) return false;
        if (Array.isArray(v.value) && v.value.length === 0) return false;
        return true;
      }),
    );
    const payload = {
      projectId: project.id,
      traceId: props.traceId,
      comment,
      scoreOptions: cleanScores,
      expectedOutput: props.mode === "suggest" ? expectedOutput : undefined,
    };
    const onSuccess = () => {
      void trpc.annotation.getByTraceId.invalidate();
      toaster.create({
        title: isEdit ? "Annotation updated" : "Annotation saved",
        type: "success",
      });
      props.onOpenChange(false);
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

  const handleDelete = () => {
    if (!project?.id || !existing) return;
    remove.mutate(
      { projectId: project.id, annotationId: existing.id },
      {
        onSuccess: () => {
          void trpc.annotation.getByTraceId.invalidate();
          toaster.create({ title: "Annotation deleted", type: "success" });
          props.onOpenChange(false);
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
    comment,
    setComment,
    expectedOutput,
    setExpectedOutput,
    scoreOptions,
    setScoreOptions,
    scores,
    isEdit,
    isSaving: create.isLoading || update.isLoading,
    isDeleting: remove.isLoading,
    hasExisting: !!existing,
    handleSave,
    handleDelete,
    onCancel: () => props.onOpenChange(false),
    mode: props.mode,
  };
}

function AnnotateBody({ state }: { state: AnnotationFormState }) {
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

      <FormFooter state={state} />
    </VStack>
  );
}

/**
 * Suggest layout uses fixed heights for both the textarea and the diff
 * panel, so the popover never resizes as the user types — no jumping, no
 * fight between edit and diff for vertical space.
 */
function SuggestBody({
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
        // Fixed height — locked to a stable size so the popover never
        // grows or jumps based on the user's edit. Internal scroll instead.
        height="180px"
        minHeight="180px"
        maxHeight="180px"
        resize="none"
        fontFamily="mono"
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
      <DiffPanel
        original={originalOutput}
        edited={state.expectedOutput}
      />

      <CommentField value={state.comment} onChange={state.setComment} />

      <ScoreFields state={state} />

      <FormFooter state={state} />
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
            options={(s.options as AnnotationScoreOption[]) ?? []}
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

function FormFooter({ state }: { state: AnnotationFormState }) {
  return (
    <HStack width="full" paddingTop={1}>
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

  const display = useMemo(() => {
    if (value == null || value === "") return null;
    if (Array.isArray(value)) {
      if (value.length === 0) return null;
      return value.length === 1 ? value[0] : `${value.length} selected`;
    }
    return String(value);
  }, [value]);

  const toggle = (optValue: string) => {
    if (isMulti) {
      const current = Array.isArray(value)
        ? value
        : value
          ? [String(value)]
          : [];
      const next = current.includes(optValue)
        ? current.filter((v) => v !== optValue)
        : [...current, optValue];
      onChange(next, draftReason);
    } else {
      const next = optValue === value ? "" : optValue;
      onChange(next, draftReason);
      // Single-select keys close the popover on pick — there's nothing
      // more to do unless the user wants to add a reason, which they can
      // re-open the chip to add.
      if (next !== "") setOpen(false);
    }
  };

  const isSelected = (optValue: string) => {
    if (isMulti && Array.isArray(value)) return value.includes(optValue);
    return value === optValue;
  };

  // Only fire onChange when the reason actually changed — saves a no-op
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
      positioning={{ placement: "bottom-start" }}
    >
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
          {reason && (
            <Icon as={MessageSquareText} boxSize={2.5} marginLeft={1} />
          )}
        </Button>
      </Popover.Trigger>
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
                      toggle(optValue);
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
      <Text textStyle="2xs" color="green.fg" fontFamily="mono">
        +{counts.added}
      </Text>
      <Text textStyle="2xs" color="red.fg" fontFamily="mono">
        −{counts.removed}
      </Text>
    </HStack>
  );
}

/**
 * Read-only word-level diff. Fixed height with internal scroll — the
 * panel size is locked so the popover doesn't resize as the user types.
 * `useDeferredValue` keeps typing snappy by recomputing the diff at idle.
 */
function DiffPanel({
  original,
  edited,
}: {
  original: string;
  edited: string;
}) {
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
      fontFamily="mono"
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

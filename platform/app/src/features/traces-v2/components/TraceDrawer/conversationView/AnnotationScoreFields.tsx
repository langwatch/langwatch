import {
  Box,
  Button,
  HStack,
  Icon,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Check, MessageSquareText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Popover } from "~/components/ui/popover";
import type {
  AnnotationFormState,
  AnnotationScoreOption,
  ScoreChipProps,
} from "./annotationForm.types";

/** The project's active score keys, as chips the reviewer rates on. */
export function ScoreFields({ state }: { state: AnnotationFormState }) {
  if (!state.scores.data || state.scores.data.length === 0) return null;
  return (
    <VStack align="stretch" gap={1.5}>
      <Text
        textStyle="2xs"
        color="fg.muted"
        fontWeight="600"
        textTransform="uppercase"
        letterSpacing="0.06em"
      >
        Scores
      </Text>
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

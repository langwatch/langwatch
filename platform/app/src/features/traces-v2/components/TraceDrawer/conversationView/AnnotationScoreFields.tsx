import {
  Box,
  Button,
  HStack,
  Icon,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { MessageSquareText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Checkbox, CheckboxGroup } from "~/components/ui/checkbox";
import { Popover } from "~/components/ui/popover";
import { Radio, RadioGroup } from "~/components/ui/radio";
import type {
  AnnotationFormState,
  AnnotationScoreOption,
  ScoreChipProps,
} from "./annotationForm.types";

/**
 * The project's active score keys, as chips the reviewer rates on.
 *
 * A comment about one part of the trace is offered none of them. A score is a
 * project-wide key with no notion of a target, and it becomes a column for the
 * whole trace, so a score given while pointing at one attribute would end up
 * read as a judgement on everything the trace did.
 */
export function ScoreFields({ state }: { state: AnnotationFormState }) {
  if (state.isAnchored) return null;
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
 * A rating as the editor holds it: a list of picked options either way, so
 * single-value and multi-value keys share one buffer. A single-value key gives
 * that list back as its one option, or as nothing when it has none.
 */
function toSelection(value: string | string[] | undefined): string[] {
  if (value == null || value === "") return [];
  const list = Array.isArray(value) ? value : [String(value)];
  return list.filter((v) => v !== "");
}

/**
 * One score key as a chip with an editor behind it. The editor buffers: picking
 * an option, ticking several, and typing a reason all stay local until the
 * reviewer confirms with OK, which commits the rating and the reason together
 * and closes. Clear commits an empty rating, returning the key to unrated.
 * Leaving any other way (Escape, a click outside, opening another chip) keeps
 * what was already committed, so the chip only ever reads what was confirmed.
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
  const [draftSelection, setDraftSelection] = useState<string[]>(() =>
    toSelection(value),
  );
  const [draftReason, setDraftReason] = useState(reason);

  // The editor starts from what is committed every time it opens, so a session
  // the reviewer walked away from leaves nothing behind for the next one.
  useEffect(() => {
    if (!open) return;
    setDraftSelection(toSelection(value));
    setDraftReason(reason);
  }, [open, value, reason]);

  const display = useMemo(() => describeScoreValue(value), [value]);

  const commit = (selection: string[], nextReason: string) => {
    onChange(isMulti ? selection : (selection[0] ?? ""), nextReason);
    setOpen(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
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
              isMulti={isMulti}
              selection={draftSelection}
              onSelectionChange={setDraftSelection}
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
            <HStack justify="space-between">
              <Button
                size="2xs"
                variant="ghost"
                color="fg.muted"
                onClick={(e) => {
                  e.stopPropagation();
                  commit([], "");
                }}
              >
                Clear
              </Button>
              <Button
                size="2xs"
                colorPalette="blue"
                onClick={(e) => {
                  e.stopPropagation();
                  commit(draftSelection, draftReason);
                }}
              >
                OK
              </Button>
            </HStack>
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
          <Icon
            as={MessageSquareText}
            boxSize={2.5}
            marginLeft={1}
            aria-label={`${name} has a reason`}
          />
        )}
      </Button>
    </Popover.Trigger>
  );
}

/**
 * The key's options as the control the key actually is: checkboxes for a key
 * that takes several answers, radios for one that takes a single answer.
 */
function ScoreOptionList({
  options,
  isMulti,
  selection,
  onSelectionChange,
}: {
  options: AnnotationScoreOption[];
  isMulti: boolean;
  selection: string[];
  onSelectionChange: (selection: string[]) => void;
}) {
  if (isMulti) {
    return (
      <CheckboxGroup
        value={selection}
        onValueChange={(next: string[]) => onSelectionChange(next)}
      >
        <VStack align="start" gap={1.5}>
          {options.map((opt) => (
            <Checkbox
              key={String(opt.value)}
              value={String(opt.value)}
              size="sm"
            >
              {opt.label}
            </Checkbox>
          ))}
        </VStack>
      </CheckboxGroup>
    );
  }
  return (
    <RadioGroup
      size="sm"
      value={selection[0] ?? ""}
      onValueChange={({ value }: { value: string | null }) =>
        onSelectionChange(value ? [value] : [])
      }
    >
      <VStack align="start" gap={1.5}>
        {options.map((opt) => (
          <Radio key={String(opt.value)} value={String(opt.value)}>
            {opt.label}
          </Radio>
        ))}
      </VStack>
    </RadioGroup>
  );
}

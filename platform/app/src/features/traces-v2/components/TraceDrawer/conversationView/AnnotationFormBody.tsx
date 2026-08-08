import {
  Button,
  HStack,
  Icon,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Crosshair, RotateCcw, Trash2 } from "lucide-react";
import { DiffCounts, DiffPanel, useOutputDiff } from "./AnnotationOutputDiff";
import { ScoreFields } from "./AnnotationScoreFields";
import type { AnnotationFormState } from "./annotationForm.types";

export function AnnotateBody({ state }: { state: AnnotationFormState }) {
  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0.5}>
        <HStack>
          <Text textStyle="sm" fontWeight="600">
            {state.isEdit ? "Edit annotation" : "Add annotation"}
          </Text>
          <Spacer />
          <DeleteAnnotationButton state={state} />
        </HStack>
        <AnchorLine label={state.anchorLabel} />
      </VStack>

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
 * What the comment being written is about, when it is about one part of the
 * trace. A comment about the trace as a whole names nothing: the form is
 * already on that trace and there is no narrower target to report.
 */
function AnchorLine({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <HStack gap={1} maxWidth="full">
      <Icon as={Crosshair} boxSize={3} color="purple.fg" flexShrink={0} />
      <Text
        textStyle="2xs"
        color="purple.fg"
        truncate
        title={label}
        data-testid="annotation-composer-anchor"
      >
        {label}
      </Text>
    </HStack>
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
  const diffParts = useOutputDiff({
    original: originalOutput,
    edited: state.expectedOutput,
  });

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0.5}>
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
          <DeleteAnnotationButton state={state} />
        </HStack>
        <AnchorLine label={state.anchorLabel} />
      </VStack>

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

      <HStack gap={2}>
        <SectionLabel>Diff</SectionLabel>
        <Spacer />
        <DiffCounts parts={diffParts} />
      </HStack>
      <DiffPanel parts={diffParts} />

      <CommentField value={state.comment} onChange={state.setComment} />

      <ScoreFields state={state} />
    </VStack>
  );
}

/** Removing the annotation, offered only once there is one to remove. */
function DeleteAnnotationButton({ state }: { state: AnnotationFormState }) {
  if (!state.isEdit || !state.hasExisting) return null;
  return (
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
  );
}

function SectionLabel({ children }: { children: string }) {
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
        // An edit cannot be written back before the annotation it edits has
        // been read, and the reviewer should see that rather than click into
        // a save that quietly does nothing.
        disabled={state.isSaveBlocked}
      >
        {state.isEdit ? "Update" : "Save"}
      </Button>
    </HStack>
  );
}

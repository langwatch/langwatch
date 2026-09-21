import { Box, Button, HStack, Icon, Text, Textarea } from "@chakra-ui/react";
import { useCallback, useMemo } from "react";
import { LuRotateCcw, LuTriangleAlert } from "react-icons/lu";
import { IO_DISPLAY_TRUNCATE_AT } from "../IOViewer";

const MIN_ROWS = 4;
const MAX_ROWS = 24;

/**
 * Seeds the editor. A captured value that holds JSON is formatted across lines
 * so the reviewer can find the part they want to change instead of scanning one
 * very long line; anything else is shown exactly as it was captured.
 */
export function seedEditorText(captured: string | null | undefined): string {
  if (!captured) return "";
  const trimmed = captured.trim();
  if (trimmed.length === 0) return captured;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return captured;
  }
}

function isJsonText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

interface EditableIOFieldProps {
  /** "Input", "Output": the section heading the reviewer is editing. */
  label: string;
  /** The value as captured, before any correction. */
  captured: string | null | undefined;
  /** The reviewer's text, or undefined while the field is untouched. */
  draft: string | undefined;
  onChange: (text: string) => void;
  onReset: () => void;
}

/**
 * Inline editor for one captured input or output. Plain text on purpose: the
 * reviewer is correcting what the model saw or said, and every rendering the
 * drawer offers (chat, markdown, JSON) is a view of the same string.
 */
export function EditableIOField({
  label,
  captured,
  draft,
  onChange,
  onReset,
}: EditableIOFieldProps) {
  const seed = useMemo(() => seedEditorText(captured), [captured]);
  const value = draft ?? seed;
  const isEdited = draft !== undefined;

  const isCapturedJson = useMemo(() => isJsonText(captured ?? ""), [captured]);
  // Only warn when the captured value WAS structured. Warning on prose would
  // fire on every keystroke of a field that was never JSON to begin with.
  const isPlainTextWarningVisible =
    isCapturedJson && value.trim().length > 0 && !isJsonText(value);

  const delta = value.length - seed.length;
  const rows = useMemo(
    () => Math.min(MAX_ROWS, Math.max(MIN_ROWS, value.split("\n").length + 1)),
    [value],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) =>
      onChange(event.target.value),
    [onChange],
  );

  if ((captured?.length ?? 0) > IO_DISPLAY_TRUNCATE_AT) {
    return <TooLargeToEditNotice label={label} />;
  }

  return (
    <Box>
      <FieldHeader
        label={label}
        delta={delta}
        isEdited={isEdited}
        onReset={onReset}
      />
      <Textarea
        aria-label={`Edit ${label.toLowerCase()}`}
        value={value}
        onChange={handleChange}
        rows={rows}
        fontFamily="mono"
        textStyle="xs"
        resize="vertical"
        borderColor={isEdited ? "green.muted" : "border"}
        bg={isEdited ? "green.subtle" : "bg.panel"}
      />
      {isPlainTextWarningVisible && (
        <HStack gap={1.5} marginTop={1} color="orange.fg">
          <Icon as={LuTriangleAlert} boxSize={3} />
          <Text textStyle="2xs">
            Not valid JSON. It will be saved as plain text.
          </Text>
        </HStack>
      )}
    </Box>
  );
}

/**
 * Stands in for the editor when the captured value runs past what the drawer
 * renders, so the field says why it cannot be corrected here rather than
 * offering a textarea seeded with a value cut short.
 */
function TooLargeToEditNotice({ label }: { label: string }) {
  return (
    <Box>
      <FieldHeading label={label} />
      <Box
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        bg="bg.subtle"
        paddingX={3}
        paddingY={2}
      >
        <Text textStyle="xs" color="fg.muted">
          This field is too large to edit here
        </Text>
      </Box>
    </Box>
  );
}

/** The heading row: what is being edited, how much it grew, how to undo it. */
function FieldHeader({
  label,
  delta,
  isEdited,
  onReset,
}: {
  label: string;
  /** Characters the correction added or removed, against what was captured. */
  delta: number;
  isEdited: boolean;
  onReset: () => void;
}) {
  return (
    <HStack gap={2} marginBottom={1} align="center">
      <FieldHeading label={label} />
      {delta !== 0 && (
        <Text
          textStyle="2xs"
          fontFamily="mono"
          color={delta > 0 ? "green.fg" : "red.fg"}
        >
          {delta > 0 ? `+${delta}` : `${delta}`}
        </Text>
      )}
      {isEdited && (
        <Button
          size="xs"
          variant="ghost"
          onClick={onReset}
          gap={1}
          marginLeft="auto"
        >
          <Icon as={LuRotateCcw} boxSize={3} />
          <Text textStyle="2xs">Reset</Text>
        </Button>
      )}
    </HStack>
  );
}

function FieldHeading({ label }: { label: string }) {
  return (
    <Text
      textStyle="2xs"
      fontWeight="bold"
      color="fg.muted"
      textTransform="uppercase"
      letterSpacing="0.08em"
    >
      {label}
    </Text>
  );
}

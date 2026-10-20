import { Box, Button, chakra, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

import { Tooltip } from "../overlays/tooltip.tsx";

/** Section width below which a row wraps its value under the name. */
const NARROW_BELOW = "400px";
const CONTROL_HEIGHT = "32px";

type FieldEditorProps = {
  label: string;
  headingId?: string;
  addAction?: ReactNode;
  empty: boolean;
  emptyMessage: string;
  children?: ReactNode;
  message?: ReactNode;
  "data-testid"?: string;
};

/**
 * A labelled editable list (variables, outputs): heading and add action on one
 * line, then rows that share one column template. The feature owns the draft.
 */
export function FieldEditor({
  label,
  headingId,
  addAction,
  empty,
  emptyMessage,
  children,
  message,
  "data-testid": testId,
}: FieldEditorProps) {
  return (
    <VStack
      as="section"
      align="stretch"
      gap={3}
      width="full"
      aria-labelledby={headingId}
      aria-label={headingId ? undefined : label}
      containerType="inline-size"
      data-testid={testId}
    >
      <HStack width="full" justify="space-between" minHeight={CONTROL_HEIGHT}>
        <Text
          id={headingId}
          textStyle="xs"
          fontWeight="bold"
          textTransform="uppercase"
          color="fg.muted"
        >
          {label}
        </Text>
        {addAction}
      </HStack>
      {empty ? (
        <Text textStyle="bodySm" color="fg.subtle">
          {emptyMessage}
        </Text>
      ) : (
        <VStack align="stretch" gap={2}>
          {children}
        </VStack>
      )}
      {message}
    </VStack>
  );
}

type FieldEditorRowProps = {
  typeControl: ReactNode;
  nameControl: ReactNode;
  info?: ReactNode;
  value?: ReactNode;
  valueLabel?: string;
  separator?: ReactNode;
  removeAction?: ReactNode;
  "data-testid"?: string;
};

/**
 * One inline row: type and name at their own width (name capped at half the row),
 * the separator right after the name, the value taking the rest, then remove.
 * Under 400px of section width the value drops below.
 */
export function FieldEditorRow({
  typeControl,
  nameControl,
  info,
  value,
  valueLabel,
  separator,
  removeAction,
  "data-testid": testId,
}: FieldEditorRowProps) {
  return (
    <Box
      display="grid"
      width="full"
      columnGap={2}
      rowGap={1}
      alignItems="start"
      gridTemplateColumns="auto minmax(0, 1fr) auto"
      gridTemplateAreas={'"type name remove" "value value value"'}
      css={{
        [`@container (min-width: ${NARROW_BELOW})`]: {
          gridTemplateColumns: "auto fit-content(50%) auto minmax(0, 1fr) auto",
          gridTemplateAreas: '"type name sep value remove"',
        },
      }}
      data-testid={testId}
    >
      <Box gridArea="type" minHeight={CONTROL_HEIGHT} display="flex" alignItems="center">
        {typeControl}
      </Box>
      <HStack gridArea="name" gap={1} minWidth={0} minHeight={CONTROL_HEIGHT}>
        {nameControl}
        {info}
      </HStack>
      <Box
        gridArea="sep"
        display="none"
        minHeight={CONTROL_HEIGHT}
        alignItems="center"
        justifyContent="center"
        css={{ [`@container (min-width: ${NARROW_BELOW})`]: { display: "flex" } }}
      >
        {value ? separator : null}
      </Box>
      <Box gridArea="value" minWidth={0} display={value ? "block" : "none"}>
        {valueLabel && (
          <Text
            textStyle="bodySm"
            color="fg.muted"
            marginBottom={1}
            css={{ [`@container (min-width: ${NARROW_BELOW})`]: { display: "none" } }}
          >
            {valueLabel}
          </Text>
        )}
        <Box minHeight={CONTROL_HEIGHT}>{value}</Box>
      </Box>
      <Box gridArea="remove" display="flex" justifyContent="flex-end">
        {removeAction}
      </Box>
    </Box>
  );
}

type FieldEditorNameProps = {
  value: string;
  editing: boolean;
  draft: string;
  readOnly?: boolean;
  invalid?: boolean;
  ariaLabel: string;
  onStartEdit: () => void;
  onDraftChange: (draft: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  displayTestId: string;
  inputTestId: string;
};

const nameBox = {
  height: CONTROL_HEIGHT,
  minWidth: 0,
  maxWidth: "100%",
  paddingX: 2,
  borderWidth: "1px",
  borderColor: "transparent",
  borderRadius: "lg",
  fontFamily: "mono",
  textStyle: "bodySm",
} as const;

/** The inline name: text at rest, an input while editing, both on one border box. */
export function FieldEditorName({
  value,
  editing,
  draft,
  readOnly = false,
  invalid = false,
  ariaLabel,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancel,
  displayTestId,
  inputTestId,
}: FieldEditorNameProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ignoreBlur = useRef(false);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) {
      const frame = requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        if (input.value === value) input.select();
      });
      return () => cancelAnimationFrame(frame);
    }
    if (returnFocus.current) {
      returnFocus.current = false;
      buttonRef.current?.focus();
    }
  }, [editing, value]);

  const settle = (action: () => void) => {
    ignoreBlur.current = true;
    action();
    setTimeout(() => {
      ignoreBlur.current = false;
    }, 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      settle(onCommit);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      returnFocus.current = true;
      settle(onCancel);
    }
  };

  if (readOnly) {
    return (
      <Text
        {...nameBox}
        display="flex"
        alignItems="center"
        cursor="default"
        title={value}
        data-testid={displayTestId}
      >
        <Box as="span" truncate>
          {value}
        </Box>
      </Text>
    );
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onBlur={() => {
          if (!ignoreBlur.current) onCommit();
        }}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        flex="1"
        _hover={{ borderColor: "border" }}
        {...nameBox}
        borderColor={invalid ? "border.error" : "transparent"}
        data-testid={inputTestId}
      />
    );
  }

  return (
    <chakra.button
      ref={buttonRef}
      type="button"
      onClick={onStartEdit}
      aria-label={ariaLabel}
      title={value}
      cursor="pointer"
      textAlign="start"
      color="fg"
      _hover={{ borderColor: "border" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "colorPalette.focusRing" }}
      {...nameBox}
      borderColor={invalid ? "border.error" : "transparent"}
      aria-invalid={invalid || undefined}
      data-testid={displayTestId}
    >
      <Box as="span" truncate display="block">
        {value}
      </Box>
    </chakra.button>
  );
}

type FieldEditorRemoveProps = {
  label: string;
  tooltip: string;
  disabled?: boolean;
  onClick: () => void;
  "data-testid"?: string;
};

/** The one remove button: same size, grey and focus ring in every list. */
export function FieldEditorRemove({
  label,
  tooltip,
  disabled = false,
  onClick,
  "data-testid": testId,
}: FieldEditorRemoveProps) {
  return (
    <Tooltip content={tooltip} positioning={{ placement: "top" }}>
      <Button
        type="button"
        variant="ghost"
        colorPalette="gray"
        color="fg.subtle"
        width={CONTROL_HEIGHT}
        height={CONTROL_HEIGHT}
        minWidth={CONTROL_HEIGHT}
        padding={0}
        flexShrink={0}
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
        data-testid={testId}
      >
        <X size={14} />
      </Button>
    </Tooltip>
  );
}

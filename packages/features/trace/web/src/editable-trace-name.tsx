import { Box, HStack, IconButton, Input, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { toaster } from "@langwatch/design-system/toaster";
import { TRACE_NAME_MAX_LENGTH } from "@langwatch/trace-contract";
import { useEffect, useId, useRef, useState } from "react";
import { LuCheck, LuX } from "react-icons/lu";
import { useRenameTrace } from "./internal/use-rename-trace";

export type EditableTraceNameProps = {
  projectId: string;
  traceId: string;
  /** Already-resolved title text — composes the same fallback chain the read-only header uses. */
  titleText: string;
  /** When true the title text was a fallback (trace ID prefix), so we render it muted. */
  titleIsFallback: boolean;
};

/**
 * Read-only trace name with a pencil affordance and double-click to edit.
 *
 * Validation rules mirror the server schema (TRACE_NAME_MIN_LENGTH /
 * MAX_LENGTH from the trace contract) — keeping them in lockstep so the user
 * gets immediate inline feedback while typing AND the server still rejects bad
 * input on its own. Server-side `ValidationError`s come back via tRPC's
 * `domainError` payload; we surface them in a toast and keep the editor open so
 * the user can correct the value.
 *
 * The fallback case (trace has no name yet) still allows editing — we seed the
 * input with empty text so renaming a freshly arrived trace works exactly like
 * renaming a labelled one.
 */
export function EditableTraceName({
  projectId,
  traceId,
  titleText,
  titleIsFallback,
}: EditableTraceNameProps) {
  const { rename, isPending } = useRenameTrace();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const errorId = useId();

  const trimmed = draft.trim();
  const localValidationMessage = (() => {
    if (trimmed.length === 0) return "Name can't be empty";
    if (trimmed.length > TRACE_NAME_MAX_LENGTH) {
      return `Name is too long (max ${TRACE_NAME_MAX_LENGTH} chars)`;
    }
    return null;
  })();

  useEffect(() => {
    if (isEditing) {
      // Defer the focus so the input has actually mounted before we try to grab
      // it; without the rAF the cursor ended up at position 0 half the time
      // after the React 18 batched render.
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [isEditing]);

  function startEditing() {
    setDraft(titleIsFallback ? "" : titleText);
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setDraft("");
  }

  async function commitEditing() {
    if (localValidationMessage) return; // disabled state already prevents submit
    if (trimmed === titleText && !titleIsFallback) {
      // No-op rename — close without an extra round-trip.
      setIsEditing(false);
      return;
    }

    const outcome = await rename({ projectId, traceId, newName: trimmed });
    if (outcome.ok) {
      setIsEditing(false);
      return;
    }

    // The server sends the handled error's code and meta, never prose
    // (ADR-045), so the copy is written here. A too-long name is the one case
    // worth spelling out, using the limit the server reported; everything else
    // gets one calm generic line. The editor stays open either way so the user
    // can correct the value.
    toaster.error({
      title: "Couldn't rename trace",
      description:
        outcome.reason === "too-long"
          ? `Trace names are limited to ${outcome.maxLength} characters (you used ${outcome.receivedLength}).`
          : "That name couldn't be saved. Try again.",
    });
  }

  if (!isEditing) {
    return (
      <Tooltip
        content={
          <VStack align="start" gap={0.5}>
            <Text textStyle="xs">Trace name, derived from the root span.</Text>
            <Text textStyle="xs" color="fg.muted">
              Click to rename.
            </Text>
          </VStack>
        }
        positioning={{ placement: "bottom-start" }}
        openDelay={400}
      >
        <Text
          fontWeight="semibold"
          textStyle="md"
          truncate
          letterSpacing="-0.005em"
          minWidth={0}
          color={titleIsFallback ? "fg.muted" : undefined}
          cursor="help"
          onClick={startEditing}
          onDoubleClick={startEditing}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              startEditing();
            }
          }}
        >
          {titleText}
        </Text>
      </Tooltip>
    );
  }

  return (
    <Box position="relative" minWidth={0} flex={1}>
      <HStack gap={1} minWidth={0}>
        <Input
          ref={inputRef}
          size="xs"
          fontSize="md"
          fontWeight="semibold"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitEditing();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEditing();
            }
          }}
          aria-invalid={localValidationMessage !== null}
          aria-describedby={localValidationMessage ? errorId : undefined}
          maxLength={TRACE_NAME_MAX_LENGTH + 50}
          placeholder="Trace name"
          // Prevent the row's outer double-click handler from re-opening the
          // editor on top of itself when the user double-clicks inside the
          // input (e.g. selecting a word).
          onDoubleClick={(e) => e.stopPropagation()}
          flex={1}
          minWidth={0}
        />
        <Tooltip content="Save (↵)" positioning={{ placement: "bottom" }}>
          <IconButton
            aria-label="Save trace name"
            size="2xs"
            variant="ghost"
            color="green.fg"
            disabled={localValidationMessage !== null || isPending}
            onClick={() => void commitEditing()}
          >
            <LuCheck size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Cancel (Esc)" positioning={{ placement: "bottom" }}>
          <IconButton
            aria-label="Cancel trace name edit"
            size="2xs"
            variant="ghost"
            color="fg.muted"
            onClick={cancelEditing}
          >
            <LuX size={14} />
          </IconButton>
        </Tooltip>
      </HStack>
      {/* Counter + validation float beneath the input row (absolute, out of
          flow) so they don't add height to this box — otherwise the header
          row's `align="center"` re-centres the sibling status orb against the
          taller box and the orb visibly drops while editing. See
          specs/traces-v2/editable-trace-name-alignment.feature */}
      {localValidationMessage && (
        <Text
          id={errorId}
          textStyle="2xs"
          color="red.fg"
          position="absolute"
          top="100%"
          left={0}
          marginTop={0.5}
          role="alert"
        >
          {localValidationMessage}
        </Text>
      )}
      {!localValidationMessage && trimmed.length > 0 && (
        <Text
          textStyle="2xs"
          color="fg.subtle"
          position="absolute"
          top="100%"
          left={0}
          marginTop={0.5}
        >
          {trimmed.length}/{TRACE_NAME_MAX_LENGTH}
        </Text>
      )}
    </Box>
  );
}

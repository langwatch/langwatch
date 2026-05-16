import { Box, HStack, IconButton, Input, Text, VStack } from "@chakra-ui/react";
import { useEffect, useId, useRef, useState } from "react";
import { LuCheck, LuX } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { toaster } from "~/components/ui/toaster";
import {
  TRACE_NAME_MAX_LENGTH,
  TRACE_NAME_MIN_LENGTH,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import { api } from "~/utils/api";

interface EditableTraceNameProps {
  traceId: string;
  /** Already-resolved title text — composes the same fallback chain the read-only header uses. */
  titleText: string;
  /** When true the title text was a fallback (trace ID prefix), so we render it muted. */
  titleIsFallback: boolean;
}

interface InvalidationKeys {
  traceId: string;
}

/**
 * Read-only trace name with a pencil affordance and double-click to edit.
 *
 * Validation rules mirror the server schema (TRACE_NAME_MIN_LENGTH /
 * MAX_LENGTH from constants.ts) — keeping them in lockstep so the user
 * gets immediate inline feedback while typing AND the server still
 * rejects bad input on its own. Server-side `ValidationError`s come
 * back via tRPC's `domainError` payload; we surface them in a toast
 * and keep the editor open so the user can correct the value.
 *
 * The fallback case (trace has no name yet) still allows editing — we
 * seed the input with empty text so renaming a freshly arrived trace
 * works exactly like renaming a labelled one.
 */
export function EditableTraceName({
  traceId,
  titleText,
  titleIsFallback,
}: EditableTraceNameProps) {
  const { project } = useOrganizationTeamProject();
  const utils = api.useUtils();
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

  const mutation = api.tracesV2.changeName.useMutation({
    onSuccess: async ({ traceId: id }: { traceId: string }) => {
      // Bring the drawer + table in sync with the new name. We invalidate
      // the trace header (drawer title), the lists (table cells), and any
      // peek queries that paint the same name in tooltips.
      const keys: InvalidationKeys = { traceId: id };
      await Promise.all([
        utils.tracesV2.header.invalidate({
          projectId: project!.id,
          traceId: keys.traceId,
        }),
        utils.tracesV2.list.invalidate(),
      ]);
      setIsEditing(false);
    },
    onError: (error) => {
      // The server attaches the serialised DomainError to error.data so
      // we can show the rich message + meta — falls back to error.message
      // for unhandled cases.
      const dErr = error.data?.domainError;
      const meta = (dErr?.meta ?? {}) as Record<string, unknown>;
      const description =
        typeof meta.field === "string" && typeof meta.maxLength === "number"
          ? `${error.message} (got ${String(meta.receivedLength ?? "?")} chars)`
          : error.message;
      toaster.error({
        title: "Couldn't rename trace",
        description,
      });
    },
  });

  useEffect(() => {
    if (isEditing) {
      // Defer the focus so the input has actually mounted before we try
      // to grab it; without the rAF the cursor ended up at position 0
      // half the time after the React 18 batched render.
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

  function commitEditing() {
    if (!project) return;
    if (localValidationMessage) return; // disabled state already prevents submit
    if (trimmed === titleText && !titleIsFallback) {
      // No-op rename — close without an extra round-trip.
      setIsEditing(false);
      return;
    }
    mutation.mutate({
      projectId: project.id,
      traceId,
      newName: trimmed,
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
              commitEditing();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEditing();
            }
          }}
          aria-invalid={localValidationMessage !== null}
          aria-describedby={localValidationMessage ? errorId : undefined}
          maxLength={TRACE_NAME_MAX_LENGTH + 50}
          placeholder="Trace name"
          // Prevent the row's outer double-click handler from re-opening
          // the editor on top of itself when the user double-clicks
          // inside the input (e.g. selecting a word).
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
            disabled={localValidationMessage !== null || mutation.isPending}
            onClick={commitEditing}
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
      {localValidationMessage && (
        <Text
          id={errorId}
          textStyle="2xs"
          color="red.fg"
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
          marginTop={0.5}
        >
          {trimmed.length}/{TRACE_NAME_MAX_LENGTH}
        </Text>
      )}
    </Box>
  );
}

export const TRACE_NAME_LIMITS = {
  min: TRACE_NAME_MIN_LENGTH,
  max: TRACE_NAME_MAX_LENGTH,
} as const;

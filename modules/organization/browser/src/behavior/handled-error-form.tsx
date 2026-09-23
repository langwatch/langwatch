/** Server rejections placed where the reader is looking; field errors not toasts. */

import { Alert, Box, HStack, Stack, Text } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";

/**
 * The generic line, shared by both slots below so the two never disagree —
 * word for word the application registry's unknown-error description, since
 * a failure reading differently in a drawer than on the page is two products.
 */
export const UNKNOWN_ERROR_DESCRIPTION = "We've been notified. Try again in a moment.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type HandledErrorShape = {
  code: string;
  httpStatus: number;
  /** Whatever the code documented. Read by key, never spread into the UI. */
  meta: Record<string, unknown>;
};

/** The tRPC envelope's payload, or `null` when the failure was not a handled one. */
export function readHandledError(error: unknown): HandledErrorShape | null {
  const candidate = (error as { data?: { error?: unknown } } | null)?.data?.error;
  if (!isRecord(candidate)) return null;
  const code = typeof candidate.code === "string" ? candidate.code : null;
  if (code === null) return null;
  if (typeof candidate.httpStatus !== "number") return null;
  return {
    code,
    httpStatus: candidate.httpStatus,
    meta: isRecord(candidate.meta) ? candidate.meta : {},
  };
}

/** The key `applyHandledErrorToForm` writes a whole-form refusal under. */
export const FORM_SERVER_ERROR = "root.serverError";

/**
 * As much of a react-hook-form as these two helpers touch — structural and
 * deliberately loose, since the forms passed in are typed by their own value
 * shapes, and narrowing `setError` to `string` would make every caller cast.
 */
type MinimalForm = {
  setError: (name: any, error: { type: string; message: string }) => void;
  formState: { errors: Record<string, unknown> };
};

/**
 * Places a server's field-level rejection on the fields it named. Answers
 * `true` when it placed something; a caller with no whole-form slot gets
 * `false` for a field-less refusal, free to render it another way.
 */
export function applyHandledErrorToForm({
  error,
  form,
  hasFormErrorSlot,
}: {
  error: unknown;
  form: MinimalForm;
  hasFormErrorSlot?: boolean;
}): boolean {
  const handled = readHandledError(error);
  if (!handled) return false;

  const fieldErrors = handled.meta.fieldErrors;
  let placed = false;
  if (isRecord(fieldErrors)) {
    for (const [field, message] of Object.entries(fieldErrors)) {
      const first: unknown = Array.isArray(message) ? message[0] : message;
      const text = typeof first === "string" ? first : "";
      if (!text) continue;
      form.setError(field, { type: "server", message: text });
      placed = true;
    }
  }
  if (placed) return true;
  if (!hasFormErrorSlot) return false;
  form.setError(FORM_SERVER_ERROR, { type: "server", message: UNKNOWN_ERROR_DESCRIPTION });
  return true;
}

/** Renders whatever `applyHandledErrorToForm` put in the whole-form slot. */
export function FormServerError({ form }: { form: MinimalForm }) {
  const root = form.formState.errors.root as { serverError?: { message?: string } } | undefined;
  const message = root?.serverError?.message;
  if (!message) return null;

  return (
    <Alert.Root status="error" role="alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

const HAIRLINE =
  "color-mix(in srgb, var(--chakra-colors-red-solid) 26%, var(--chakra-colors-border-muted))";

export interface HandledErrorAlertProps {
  /** Any error, handled or not. Renders nothing when there is none. */
  error: unknown;
  /** Headline for a failure we have no specific copy for. */
  fallbackTitle?: string;
  /** Hard override of the title. Rare. */
  title?: string;
}

/**
 * A failure that is still true, said in place — the inline counterpart to
 * the host's `failed` notice: a toast is for something that just happened,
 * an alert for a form that is still rejected.
 */
export function HandledErrorAlert({ error, title, fallbackTitle }: HandledErrorAlertProps) {
  if (error === null || error === void 0) return null;

  return (
    <Box
      role="alert"
      borderWidth="1px"
      borderColor={HAIRLINE}
      borderRadius="md"
      paddingX={4}
      paddingY={3}
    >
      <HStack gap={3} alignItems="flex-start">
        <Box color="red.fg" display="flex" flexShrink={0} marginTop="2px">
          <AlertCircle size={16} aria-hidden />
        </Box>
        <Stack gap={1}>
          <Text fontWeight="medium">{title ?? fallbackTitle ?? "Something went wrong"}</Text>
          <Text fontSize="sm" color="fg.muted">
            {UNKNOWN_ERROR_DESCRIPTION}
          </Text>
        </Stack>
      </HStack>
    </Box>
  );
}

/**
 * A server's rejection, placed where the reader is looking.
 *
 * The project drawers came back from `platform/app` calling four names out of
 * `~/features/errors` — an application module a feature-web package may not
 * reach. Three of the four are answered here and one is not: the words a
 * customer reads still come from the composing application's code-keyed
 * registry through `OrganizationHostPort.failed`, which is what
 * `organization-feedback.ts` already binds. What lives here is only the part
 * that decides WHERE a refusal lands, which is layout rather than copy.
 *
 * THE FIFTH FAMILY-LOCAL COPY OF THIS SHAPE, after `@langwatch/workflow-web`'s
 * `studio-host/errors`, `@langwatch/langy-web`'s `behavior/errors`,
 * `@langwatch/enterprise-governance-web`'s `handled-error-alert` and
 * `@langwatch/trace-web`'s presentation module. Every one of those recorded
 * that a repeat is the signal to promote it into one place, and every one left
 * it there, because promotion changes packages a drawer recovery does not own.
 * Recorded again rather than quietly repeated a fifth time.
 *
 * WHY IT IS NOT A TOAST. A validation refusal names fields; a toast names none
 * of them, so the reader is left to work out which of two inputs the server
 * meant. `applyHandledErrorToForm` puts the sentence on the input and answers
 * whether it managed to, which is the caller's signal not to also raise a
 * toast — a refusal reported twice reads as two failures.
 */

import { Alert, Box, HStack, Stack, Text } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";

/**
 * The generic line, shared by both slots below so the two never disagree.
 *
 * Word for word the application registry's unknown-error description, because
 * a failure that reads one way in a drawer and another way on the page behind
 * it is two products.
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
 * As much of a react-hook-form as these two helpers touch.
 *
 * Structural and deliberately loose: the forms that pass one in are typed by
 * their own value shapes, and narrowing `setError` to `string` would make every
 * caller cast.
 */
type MinimalForm = {
  // oxlint-disable-next-line no-explicit-any
  setError: (name: any, error: { type: string; message: string }) => void;
  formState: { errors: Record<string, unknown> };
};

/**
 * Places a server's field-level rejection on the fields it named.
 *
 * Answers `true` when it placed something. A caller with no whole-form slot
 * gets `false` for a refusal that named no field, and is then free to render
 * the failure some other way — which is exactly what the create-project form
 * does with its inline alert.
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
      const text = Array.isArray(message) ? String(message[0] ?? "") : String(message ?? "");
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
 * A failure that is still true, said in place.
 *
 * The inline counterpart to the host's `failed` notice: a toast is for
 * something that just happened, an alert for a form that is still rejected.
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

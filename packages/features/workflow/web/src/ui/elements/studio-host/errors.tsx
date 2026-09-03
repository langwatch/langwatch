/**
 * What the moved studio modules already do with a failure.
 *
 * `platform/app/src/features/errors` is the application's — a code-keyed
 * presentation registry, the toaster that renders it and the form binder that
 * places a rejection on the field it belongs to. None of it may be imported
 * from a feature-web package, and none of it should be copied: the words a
 * customer reads are the APPLICATION's to decide, which is exactly what the
 * family's feedback capability hands back to it.
 *
 * So the eight names thirteen files import are answered here, and each one
 * routes to `WorkflowHostPort.failed` rather than composing a sentence:
 * `failed` takes the RAW error, the host resolves the copy from its own
 * registry, and `fallbackTitle` names the action that failed for a code the
 * registry does not list. The one thing that reads the payload directly is
 * `readHandledError`, because a caller sometimes needs to know WHICH code came
 * back — `dataset_name_taken` is placed on the name field rather than toasted —
 * and that is a decision about layout, not about words.
 *
 * WHAT IS NARROWER THAN THE APPLICATION'S, named rather than hidden:
 * `applyHandledErrorToForm` places a validation refusal on the fields the
 * server named in `meta.fieldErrors`, but the SENTENCE it places is the generic
 * one — the registry that knows better lives in the application. A refusal
 * still lands where the reader is looking, which is the property the helper
 * exists for.
 */

import { Alert, Box, Button, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { useWorkflowHost, type WorkflowHostPort } from "../../../model/workflow-host";

/**
 * The generic line, shared by every slot below so the two never disagree.
 *
 * Word for word the application registry's `UNKNOWN_ERROR_PRESENTATION`
 * description, because a failure that reads one way inside the studio and
 * another way on the page next to it is two products.
 */
export const UNKNOWN_ERROR_DESCRIPTION = "We've been notified. Try again in a moment.";

export type ErrorExplanation = {
  title: string;
  description: string;
  code?: string;
  /**
   * Whether the code-keyed registry actually had words for this failure.
   *
   * Always false here: the registry is the application's, and this package can
   * only tell a handled failure from an unhandled one, not what the application
   * would say about it. The two call sites that read it use it to decide
   * whether to show their own fallback sentence, and false is the honest answer.
   */
  isRegistered?: boolean;
};

export const UNKNOWN_ERROR_PRESENTATION: ErrorExplanation = {
  title: "Something went wrong",
  description: UNKNOWN_ERROR_DESCRIPTION,
  isRegistered: false,
};

export type HandledErrorShape = {
  code: string;
  httpStatus: number;
  /** Whatever the code documented. Read by key, never spread into the UI. */
  meta: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

/** The whole explanation as one string, for slots that can only take text. */
export function describeError({
  error: _error,
  fallbackTitle,
}: {
  error: unknown;
  fallbackTitle?: string;
}): string {
  return `${fallbackTitle ?? UNKNOWN_ERROR_PRESENTATION.title}. ${UNKNOWN_ERROR_DESCRIPTION}`;
}

/**
 * The code a failure carries, from either shape it arrives in.
 *
 * A tRPC failure wraps the payload in `data.error`; a serialized handled error
 * minted in the browser (the execution stream's `nodeErrorToDomainError`, for
 * one) IS the payload. Both are read, because the caller does not always know
 * which it has.
 */
function codeOf(error: unknown): string | null {
  const handled = readHandledError(error);
  if (handled) return handled.code;
  if (isRecord(error) && typeof error.code === "string") return error.code;
  return null;
}

/**
 * What a customer reads for a failure, as much of it as this package can say.
 *
 * `isRegistered` means the failure carries a CODE, not that this package has
 * the words for it — the code-keyed registry is the composing application's and
 * did not travel. So the words are the generic ones either way, and the flag is
 * what lets a caller tell a named failure from an anonymous one: the studio's
 * execution toast keys its dedupe id on the code when there is one, so two
 * unrelated coded failures never collapse onto one toast.
 *
 * WHAT IS LOST, named rather than hidden: the registry's specific title and
 * description for a code it lists. A caller's `fallbackTitle` carries the
 * weight instead, which is why every call site passes one.
 */
export function explainAnyError(error: unknown): ErrorExplanation {
  const code = codeOf(error);
  if (code === null) return UNKNOWN_ERROR_PRESENTATION;
  return { ...UNKNOWN_ERROR_PRESENTATION, code, isRegistered: true };
}

export const explainSerializedError = explainAnyError;
export const explainHandledError = explainAnyError;

export type ShowErrorToastOptions = {
  error?: unknown;
  fallbackTitle?: string;
  description?: string;
  id?: string;
};

let mounted: WorkflowHostPort | undefined;

/** Called by the studio's host provider on mount, and cleared on unmount. */
export function setStudioErrorHost(host: WorkflowHostPort | undefined): void {
  mounted = host;
}

/**
 * Reports a failure through the application's own feedback capability.
 *
 * A singleton for the same reason the toaster is one: most of these fire from a
 * mutation callback, where no hook can run.
 */
export function showErrorToast(options: ShowErrorToastOptions): void {
  if (!mounted) {
    // eslint-disable-next-line no-console
    console.warn("A studio failure was reported with no host mounted:", options.fallbackTitle);
    return;
  }
  mounted.failed({
    error: options.error,
    fallbackTitle: options.fallbackTitle ?? UNKNOWN_ERROR_PRESENTATION.title,
    description: options.description,
    id: options.id,
  });
}

/** The key `applyHandledErrorToForm` writes a whole-form refusal under. */
export const FORM_SERVER_ERROR = "root.serverError";

/**
 * As much of a react-hook-form as these two helpers touch.
 *
 * Structural and deliberately loose: the forms that pass one in are typed by
 * their own value shapes, and narrowing `setError` to `string` would make every
 * caller cast. What is actually required is that a name can be written and the
 * error tree can be read.
 */
type MinimalForm = {
  // oxlint-disable-next-line no-explicit-any
  setError: (name: any, error: { type: string; message: string }) => void;
  formState: { errors: Record<string, unknown> };
};

/**
 * Places a server's field-level rejection on the fields it named.
 *
 * Answers `true` when it placed something, which is the caller's signal to NOT
 * also raise a toast — a refusal reported twice reads as two failures.
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
  form.setError(FORM_SERVER_ERROR, {
    type: "server",
    message: UNKNOWN_ERROR_DESCRIPTION,
  });
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

export type HandledErrorStateProps = {
  error: unknown;
  fallbackTitle?: string;
  icon?: ReactNode;
  fullHeight?: boolean;
  children?: ReactNode;
};

/** A whole-page dead end that still says what failed and offers a way out. */
export function HandledErrorState({
  error,
  fallbackTitle,
  icon,
  fullHeight = true,
  children,
}: HandledErrorStateProps) {
  const explanation = explainAnyError(error);
  return (
    <VStack
      role="alert"
      width="full"
      height={fullHeight ? "100vh" : "full"}
      justify="center"
      align="center"
      gap={4}
      padding={8}
    >
      {icon && <Box color="fg.muted">{icon}</Box>}
      <Text fontSize="lg" fontWeight="semibold">
        {fallbackTitle ?? explanation.title}
      </Text>
      <Text color="fg.muted" textAlign="center" maxWidth="480px">
        {explanation.description}
      </Text>
      {children}
    </VStack>
  );
}

/** The inline variant, for a region of a page rather than the whole of it. */
export function HandledErrorAlert({
  error,
  fallbackTitle,
  onRetry,
}: {
  error: unknown;
  fallbackTitle?: string;
  onRetry?: () => void;
}) {
  const explanation = explainAnyError(error);
  return (
    <Alert.Root status="error">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{fallbackTitle ?? explanation.title}</Alert.Title>
        <Alert.Description>{explanation.description}</Alert.Description>
      </Alert.Content>
      {onRetry && (
        <Button size="xs" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Alert.Root>
  );
}

/** Publishes the host to the two singletons above. Rendered by the host provider. */
export function useStudioErrorHostBinding(): void {
  const host = useWorkflowHost();
  setStudioErrorHost(host);
}

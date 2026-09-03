/**
 * What the moved simulation, scenario and Agent Testing modules do with a
 * failure.
 *
 * `platform/app/src/features/errors` is the APPLICATION's — a code-keyed
 * presentation registry, the toaster that renders it and the form binder that
 * places a rejection on the field it belongs to. None of it may be imported
 * from a feature-web package, and none of it is copied here: the words a
 * customer reads are the application's to decide, which is exactly what
 * `ScenarioHostPort.failed` hands back to it. The workflow family wrote the
 * same seam for the same reason, and this is that shape against this host.
 *
 * The names below are the ones twenty-six moved files import, kept letter for
 * letter so none of those files needed an edit beyond the module path.
 *
 * WHAT IS NARROWER THAN THE APPLICATION'S, named rather than hidden:
 * `applyHandledErrorToForm` places a validation refusal on the fields the
 * server named in `meta.fieldErrors`, but the SENTENCE it places is the generic
 * one — the registry that knows better lives in the application. A refusal
 * still lands where the reader is looking, which is the property the helper
 * exists for.
 */

import { Alert, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import {
  useScenarioHost,
  type ScenarioFailureAction,
  type ScenarioHostPort,
} from "../model/scenario-host";

/**
 * The generic line, shared by every slot below so the two never disagree.
 *
 * Word for word the application registry's `UNKNOWN_ERROR_PRESENTATION`
 * description, because a failure that reads one way inside a run board and
 * another way on the page next to it is two products.
 */
export const UNKNOWN_ERROR_DESCRIPTION = "We've been notified. Try again in a moment.";

export type ErrorExplanation = {
  title: string;
  description: string;
  code?: string;
  /**
   * Whether the failure carries a CODE — not whether this package has the words
   * for it. The code-keyed registry is the application's and did not travel.
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
  /** The one identifier a customer can hand to support. Absent on a browser-side refusal. */
  traceId?: string;
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
    ...(typeof candidate.traceId === "string" ? { traceId: candidate.traceId } : {}),
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
 * A tRPC failure wraps the payload in `data.error`; a handled error serialized
 * in the browser IS the payload. Both are read, because the caller does not
 * always know which it has.
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
  /**
   * The single fix this failure offers, where there is one.
   *
   * Four failures in this package have one — both "the run plan has nothing
   * runnable left in it" codes, the model-provider gate, and a generation
   * failure that needs a provider configured — and each used to reach the
   * Design System toaster directly to keep its button, giving up the
   * registry's words for it. They keep both now.
   */
  action?: ScenarioFailureAction;
  id?: string;
};

let mounted: ScenarioHostPort | undefined;

/** Called by this family's host provider on mount, and cleared on unmount. */
export function setScenarioErrorHost(host: ScenarioHostPort | undefined): void {
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
    // oxlint-disable-next-line no-console
    console.warn("A scenario failure was reported with no host mounted:", options.fallbackTitle);
    return;
  }
  mounted.failed({
    error: options.error,
    fallbackTitle: options.fallbackTitle ?? UNKNOWN_ERROR_PRESENTATION.title,
    description: options.description,
    action: options.action,
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
 * caller cast.
 */
type MinimalForm = {
  // oxlint-disable-next-line no-explicit-any
  setError: (name: any, error: { type: string; message: string }) => void;
  /**
   * Optional because one caller is not a react-hook-form at all.
   *
   * `ScenarioFormController` is the scenario form's own controller and exposes
   * `setError` without an error tree; it uses `applyHandledErrorToForm`, which
   * only writes, and never `FormServerError`, which only reads.
   */
  formState?: { errors: Record<string, unknown> };
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
  form.setError(FORM_SERVER_ERROR, { type: "server", message: UNKNOWN_ERROR_DESCRIPTION });
  return true;
}

/** Renders whatever `applyHandledErrorToForm` put in the whole-form slot. */
export function FormServerError({ form }: { form: MinimalForm }) {
  const root = form.formState?.errors.root as { serverError?: { message?: string } } | undefined;
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

/**
 * The two ways out a failed panel offers.
 *
 * `~/features/errors/components/ErrorActions` rendered a retry and a "contact
 * support" that reached the application's support widget. The retry travels;
 * the support link does not, because a feature package has no support channel
 * of its own — a caller that wants one passes `children`.
 */
export function ErrorActions({
  onRetry,
  traceId,
  children,
}: {
  onRetry?: () => void;
  /** Shown so a customer can quote it to support, exactly as the registry's did. */
  traceId?: string;
  children?: ReactNode;
}) {
  if (!onRetry && !children && !traceId) return null;
  return (
    <HStack gap={2}>
      {traceId && (
        <Text fontSize="xs" color="fg.muted">
          Reference {traceId}
        </Text>
      )}
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
      {children}
    </HStack>
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

/** Publishes the host to the singleton above. Rendered by the host provider. */
export function useScenarioErrorHostBinding(): void {
  const host = useScenarioHost();
  setScenarioErrorHost(host);
}

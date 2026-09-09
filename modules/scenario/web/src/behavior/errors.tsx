/**
 * The failure surfaces this package renders INTO a page.
 */

import { Alert, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { explainAnyError } from "@langwatch/handled-error/presentation";

/**
 * As much of a react-hook-form as {@link FormServerError} reads — the whole-form
 * slot `applyHandledErrorToForm` writes into.
 */
type MinimalForm = {
  /** Not read here — it is what identifies the value as a form at all. */
  // oxlint-disable-next-line no-explicit-any
  setError: (name: any, error: { type: string; message: string }) => void;
  formState?: { errors: Record<string, unknown> };
};

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
        {explanation.isRegistered ? explanation.title : (fallbackTitle ?? explanation.title)}
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
        <Alert.Title>
          {explanation.isRegistered ? explanation.title : (fallbackTitle ?? explanation.title)}
        </Alert.Title>
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

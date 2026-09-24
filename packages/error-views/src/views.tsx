/**
 * The failure surfaces a browser renders INTO a page, written from the
 * code-keyed presentation registry next door: the whole-page dead end, the
 * inline alert, and the whole-form slot a rejected submit fills.
 */

import { Alert, Box, Button, Text, VStack } from "@chakra-ui/react";
import { explainAnyError } from "@langwatch/error-presentation/presentation";
import type { ReactNode } from "react";

/**
 * As much of a react-hook-form as {@link FormServerError} reads — the whole-form
 * slot `applyHandledErrorToForm` writes into.
 */
type MinimalForm = {
  /** Not read here — it is what identifies the value as a form at all. */
  setError: (name: never, error: { type: string; message: string }) => void;
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

import { Box, HStack, List, Stack, Text } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";

import { isHandledByGlobalHandler } from "~/utils/trpcError";

import { explainAnyError } from "../logic/presentation";
import { readErrorTraceId, readHandledError } from "../logic/readHandledError";

import { ErrorActions } from "./ErrorActions";

/**
 * The same restrained hairline the toast wears — the tone lives in the border
 * and the icon, never in a filled wash. See `components/ui/toaster.tsx` and
 * `features/asaplangy/tokens.ts`.
 */
const HAIRLINE =
  "color-mix(in srgb, var(--chakra-colors-red-solid) 26%, var(--chakra-colors-border-muted))";

export interface HandledErrorAlertProps {
  /**
   * Any error — handled or not. Renders nothing when null/undefined, or when a
   * global interceptor has already reported it.
   */
  error: unknown;
  /**
   * Headline for a failure we have no specific copy for — "Couldn't load
   * replicas". A code the registry knows keeps its own, better title.
   * This is the one you usually want.
   */
  fallbackTitle?: string;
  /** Hard override of the title, registry entry or not. Rare. */
  title?: string;
  /**
   * Show every remediation tip as a list rather than folding the first into
   * the description. Inline alerts have the room; toasts don't.
   */
  showAllTips?: boolean;
}

/**
 * The inline counterpart to `showErrorToast` — same copy, same affordances,
 * rendered in place instead of over the top.
 *
 * Use this wherever the error belongs to a region of the page rather than to a
 * moment: a panel that failed to load, a form that was rejected, a step that
 * can't proceed. A toast is for something that just happened; an alert is for
 * something that is still true.
 */
export function HandledErrorAlert({
  error,
  title,
  fallbackTitle,
  showAllTips = true,
}: HandledErrorAlertProps) {
  if (!error) return null;

  // Already surfaced by a global interceptor in `utils/api.tsx` — the upgrade
  // modal, or one of its bespoke toasts. `showErrorToast` has always made this
  // check; the alert did not, so a plan-limit refusal drew "Something went
  // wrong / We've been notified" underneath the modal that was busy explaining
  // it properly.
  if (isHandledByGlobalHandler(error)) return null;

  const handled = readHandledError(error);
  const explanation = explainAnyError(error);

  // The registry description and the server's tips are competing authorings of
  // the same remediation — "Narrow the time range or add a filter" is both the
  // `query_timeout` description and its first tip — so rendering both makes
  // the alert repeat itself. Tips are written for agents with no registry to
  // read (ADR-045); they show here only when this client has no copy of its
  // own for the code.
  const tips = explanation.description ? [] : (handled?.tips ?? []);

  // Registry copy describes this exact failure, so it beats the caller's
  // generic headline. See `showErrorToast` for the same rule.
  const heading =
    title ??
    (explanation.isRegistered
      ? explanation.title
      : (fallbackTitle ?? explanation.title));

  return (
    <Box
      role="alert"
      borderWidth="1px"
      borderColor={HAIRLINE}
      borderRadius="12px"
      bg="bg.surface"
      _dark={{ bg: "bg.panel" }}
      paddingX="14px"
      paddingY="12px"
    >
      <HStack gap="2.5" alignItems="flex-start">
        <Box color="red.fg" display="flex" flexShrink={0} marginTop="1px">
          <AlertCircle size={15} aria-hidden="true" />
        </Box>

        <Stack gap="0.5" flex="1" minWidth={0}>
          <Text
            fontSize="13.5px"
            fontWeight="640"
            lineHeight="1.35"
            letterSpacing="-0.005em"
          >
            {heading}
          </Text>
          {explanation.description && (
            <Text fontSize="13px" lineHeight="1.5" color="fg.muted">
              {explanation.description}
            </Text>
          )}

          {showAllTips && tips.length > 0 && (
            <List.Root
              gap={0.5}
              marginTop={1.5}
              fontSize="12.5px"
              color="fg.muted"
              paddingLeft={4}
            >
              {/* Index key: tips are server-supplied prose, so two can be
                  identical and collide as keys. Their order is fixed. */}
              {tips.map((tip, index) => (
                <List.Item key={index}>{tip}</List.Item>
              ))}
            </List.Root>
          )}
          {!showAllTips && tips[0] && (
            <Text fontSize="12.5px" marginTop={1} color="fg.muted">
              {tips[0]}
            </Text>
          )}

          <ErrorActions
            docsUrl={handled?.docsUrl}
            traceId={readErrorTraceId(error)}
          />
        </Stack>
      </HStack>
    </Box>
  );
}

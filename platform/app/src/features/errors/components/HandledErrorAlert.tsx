import { Box, HStack, IconButton, List, Stack, Text } from "@chakra-ui/react";
import { AlertCircle, X } from "lucide-react";
import { useState } from "react";

import { isHandledByGlobalHandler } from "~/utils/trpcError";

import { isServerUnreachable } from "../logic/isServerUnreachable";
import { resolveErrorCopy } from "../logic/resolveErrorCopy";

import { ErrorActions } from "./ErrorActions";
import { ServerUnreachableNotice } from "./ServerUnreachableNotice";

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
  /**
   * A surface that paints its own ground — the signed-out auth screens's glass —
   * hooks its treatment on here. The alert keeps its own structure and colour;
   * only the pane it sits on changes.
   */
  className?: string;
  /**
   * Runs the failed request again. Used only when nothing answered at all,
   * where the screen becomes a wait that settles itself rather than an error
   * somebody has to act on.
   */
  onRetry?: () => void;
  /**
   * Whether the reader may put this one away. On by default: an inline alert
   * outlives the moment it describes, and a reader who has read it and cannot
   * act on it should not have to keep it on screen to carry on working.
   *
   * Dismissing hides the ALERT, never the state — the query is still failed,
   * the form still rejected — and a DIFFERENT failure brings the alert
   * straight back, so putting one away can never hide the next one.
   *
   * Turn it off where the alert is the only thing explaining why a control in
   * front of the reader will not work.
   */
  dismissible?: boolean;
  /** Told when the reader dismisses it, for a caller that keeps its own state. */
  onDismiss?: () => void;
}

/** No error has been dismissed yet — distinct from having dismissed `null`. */
const NOTHING_DISMISSED = Symbol("nothing-dismissed");

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
  className,
  onRetry,
  dismissible = true,
  onDismiss,
}: HandledErrorAlertProps) {
  // Keyed on the failure ITSELF rather than a boolean, so the alert returns
  // the moment a different one arrives. A boolean would stay true across the
  // next failure and silently swallow it.
  const [dismissed, setDismissed] = useState<unknown>(NOTHING_DISMISSED);

  if (!error) return null;

  // Already surfaced by a global interceptor in `utils/api.tsx` — the upgrade
  // modal, or one of its bespoke toasts. `showErrorToast` has always made this
  // check; the alert did not, so a plan-limit refusal drew "Something went
  // wrong / We've been notified" underneath the modal that was busy explaining
  // it properly.
  if (isHandledByGlobalHandler(error)) return null;

  // NOTHING ANSWERED. Said as a wait rather than as a fault, because that is
  // what it is: the request never left the browser, so "we've been notified"
  // is a promise nobody kept and the trace id names a trace that does not
  // exist. Ahead of the registry, since no code arrived to look up.
  if (isServerUnreachable(error)) {
    return <ServerUnreachableNotice onRetry={onRetry} className={className} />;
  }

  // Put away by the reader, and it is still the same failure. Deliberately
  // BELOW the unreachable branch: that one is a wait that settles itself and
  // retries on its own, so there is nothing there to dismiss.
  if (dismissible && dismissed === error) return null;

  // One parse, and the same two rules the toast renders — whose headline
  // wins, and which tips add to the description rather than repeating it.
  const copy = resolveErrorCopy({ error, title, fallbackTitle });
  const { tips } = copy;

  return (
    <Box
      role="alert"
      className={className}
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
            {copy.title}
          </Text>
          {copy.description && (
            <Text fontSize="13px" lineHeight="1.5" color="fg.muted">
              {copy.description}
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

          <ErrorActions docsUrl={copy.docsUrl} traceId={copy.traceId} />
        </Stack>

        {dismissible && (
          <IconButton
            aria-label="Dismiss"
            title="Dismiss"
            variant="ghost"
            size="xs"
            flexShrink={0}
            marginTop="-2px"
            marginRight="-6px"
            color="fg.muted"
            _hover={{ color: "fg", bg: "bg.muted" }}
            onClick={() => {
              setDismissed(error);
              onDismiss?.();
            }}
          >
            <X size={14} aria-hidden="true" />
          </IconButton>
        )}
      </HStack>
    </Box>
  );
}

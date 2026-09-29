/**
 * The refusal an Instant Eval met, anchored under the search bar: what the eval would have found,
 * why it did not run, and the one thing that lifts it. Closable every way.
 * @see specs/traces-v2/instant-eval-search.feature ("A refusal is a popover, never an error state")
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Link as RoutedLink } from "@langwatch/browser-host/link";
import {
  PopoverAnchor,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
} from "@langwatch/design-system/popover";
import { Sparkles } from "lucide-react";
import type React from "react";

/** Why an Instant Eval did not start, and so what the popover says. */
export type InstantEvalRefusal = { kind: "budget" } | { kind: "model" } | { kind: "unreleased" };

/** Where a paid plan is picked, which is what lifts the free budget. */
export const UPGRADE_HREF = "/settings/subscription";

/** Where a model provider is connected, which is what a judge runs on. */
export const MODEL_PROVIDERS_HREF = "/settings/model-providers";

/** Where a project without Instant Evals asks for them to be switched on. */
export const CONTACT_US_HREF =
  "mailto:support@langwatch.ai?subject=Please%20enable%20Instant%20Evals";

interface InstantEvalRefusalPopoverProps {
  refusal: InstantEvalRefusal | null;
  /** The X, a click outside or the secondary button. */
  onClose: () => void;
  children: React.ReactElement;
}

/** The popover's words, exported so the copy is pinned by a test. */
export function instantEvalRefusalCopy(refusal: InstantEvalRefusal): {
  title: string;
  body: string;
  action: { label: string; href: string };
  dismiss: string;
} {
  const what =
    "An Instant Eval reads every result in this view and keeps the ones that answer your question, which no filter can do.";
  const meanwhile = "The words are searched as a phrase in the meantime.";
  if (refusal.kind === "budget") {
    return {
      title: "Your free Instant Evals quota is used up",
      body: `${what} Upgrade to keep judging. ${meanwhile}`,
      action: { label: "Upgrade", href: UPGRADE_HREF },
      dismiss: "Skip",
    };
  }
  if (refusal.kind === "model") {
    return {
      title: "Configure a model to judge results",
      body: `${what} Configure a model to run it. ${meanwhile}`,
      action: { label: "Configure a model", href: MODEL_PROVIDERS_HREF },
      dismiss: "Skip",
    };
  }
  return {
    title: "Instant Evals aren't enabled for this project yet",
    body: "Instant Evals are a powerful new tool that turns plain language questions into native filters. Contact us so we can activate it for you.",
    action: { label: "Contact us", href: CONTACT_US_HREF },
    dismiss: "Not now",
  };
}

export function InstantEvalRefusalPopover({
  refusal,
  onClose,
  children,
}: InstantEvalRefusalPopoverProps) {
  const copy = refusal ? instantEvalRefusalCopy(refusal) : null;
  return (
    <PopoverRoot
      open={refusal !== null}
      onOpenChange={(e: { open: boolean }) => {
        if (!e.open) onClose();
      }}
      // Below the bar and never flipped over it, so the typed words stay readable.
      positioning={{ placement: "bottom-start", gutter: 8, flip: false }}
      lazyMount
      unmountOnExit
    >
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent maxWidth="360px" data-testid="instant-eval-refusal">
        <PopoverArrow />
        <PopoverBody>
          {copy && (
            <VStack align="stretch" gap={3}>
              <HStack gap={2}>
                <Box
                  width="28px"
                  height="28px"
                  borderRadius="full"
                  bg="orange.subtle"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  color="orange.fg"
                >
                  <Sparkles size={14} />
                </Box>
                <Text textStyle="sm" fontWeight="semibold">
                  {copy.title}
                </Text>
              </HStack>
              <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
                {copy.body}
              </Text>
              <HStack gap={2}>
                <RoutedLink
                  href={copy.action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "block", flex: 1 }}
                >
                  <Button
                    size="xs"
                    width="full"
                    bg="orange.solid"
                    color="white"
                    _hover={{ bg: "orange.fg" }}
                  >
                    {copy.action.label}
                  </Button>
                </RoutedLink>
                <Button size="xs" variant="ghost" onClick={onClose}>
                  {copy.dismiss}
                </Button>
              </HStack>
            </VStack>
          )}
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}

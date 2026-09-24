import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type React from "react";
import {
  PopoverAnchor,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
} from "~/components/ui/popover";
import NextLink from "~/utils/compat/next-link";

/** Why an Instant Eval did not start, and what the popover says about it. */
export type InstantEvalRefusal =
  | { kind: "budget" }
  | { kind: "model" }
  | { kind: "unreleased" };

/** Where a paid plan is picked, which is what lifts the free budget. */
export const UPGRADE_HREF = "/settings/subscription";

/** Where a model provider is connected, which is what a judge runs on. */
export const MODEL_PROVIDERS_HREF = "/settings/model-providers";

/** Where a project without Instant Evals asks for it to be switched on. */
export const CONTACT_US_HREF =
  "mailto:support@langwatch.ai?subject=Please%20enable%20Instant%20Evals";

interface InstantEvalRefusalPopoverProps {
  refusal: InstantEvalRefusal | null;
  /**
   * Closing, by the X, a click outside or the secondary button: for budget
   * and model refusals the phrase search then runs; for an unreleased
   * project there is no sentence to fall back to, so this only closes the
   * popover.
   */
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
    body: `${what} Contact us and we'll switch them on for you.`,
    action: { label: "Contact us", href: CONTACT_US_HREF },
    dismiss: "Not now",
  };
}

/**
 * The refusal an Instant Eval met, anchored to the search bar: what the eval
 * would have found here, why it did not run, and the one thing that lifts
 * it. Closable every way. A spent budget or a missing judge falls back to
 * the phrase search, so neither is ever an error state on the page; a
 * project without Instant Evals has no phrase to fall back to, so this is
 * also that project's advertisement for the feature, and closing it just
 * leaves the typed chip where the reader put it.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("A refusal is a
 * popover, never an error state").
 */
export const InstantEvalRefusalPopover: React.FC<
  InstantEvalRefusalPopoverProps
> = ({ refusal, onClose, children }) => {
  const copy = refusal ? instantEvalRefusalCopy(refusal) : null;
  return (
    <PopoverRoot
      open={refusal !== null}
      onOpenChange={(e: { open: boolean }) => {
        if (!e.open) onClose();
      }}
      // Below the bar and never flipped over it: the words the user just
      // typed stay readable next to what the popover says about them.
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
                <NextLink
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
                </NextLink>
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
};

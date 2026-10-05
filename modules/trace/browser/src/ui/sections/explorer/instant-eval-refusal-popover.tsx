/**
 * The refusal an Instant Eval met, anchored under the search bar: what the eval would have found,
 * why it did not run, and the one thing that lifts it. Closable every way.
 * @see specs/traces-v2/instant-eval-search.feature ("A refusal is a popover, never an error state")
 */

import { Link as RoutedLink } from "@langwatch/browser-host/link";
import {
  PopoverAnchor,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
} from "@langwatch/design-system/popover";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Sparkles } from "lucide-react";
import type React from "react";

/**
 * Why an Instant Eval did not start. `opt_in`, `ask_admin` and `unreleased` are one refusal told to
 * three readers: a manager of a self-serve organization is offered the switch, a member who may not
 * throw it is told to ask an admin, and an enterprise or self-hosted organization a word with us.
 */
export type InstantEvalRefusal =
  | { kind: "budget" }
  | { kind: "model" }
  | { kind: "opt_in" }
  | { kind: "ask_admin" }
  | { kind: "unreleased" };

/** Where a paid plan is picked, which is what lifts the free budget. */
export const UPGRADE_HREF = "/settings/subscription";

/** Where a model provider is connected, which is what a judge runs on. */
export const MODEL_PROVIDERS_HREF = "/settings/model-providers";

/** Where a project without Instant Evals asks for them to be switched on. */
export const CONTACT_US_HREF =
  "mailto:support@langwatch.ai?subject=Please%20enable%20Instant%20Evals";

/** The docs paragraph that says where the judged text goes. */
export const WHERE_THE_TEXT_GOES_HREF =
  "https://docs.langwatch.ai/features/instant-evals/limits-and-cost#where-the-judged-text-goes";

interface InstantEvalRefusalPopoverProps {
  refusal: InstantEvalRefusal | null;
  /** The X, a click outside or the secondary button. */
  onClose: () => void;
  /** The organization's switch, pressed by the `opt_in` popover only. */
  onEnable: () => void;
  isEnabling: boolean;
  children: React.ReactElement;
}

/**
 * The popover's words, exported so the copy is pinned by a test. An action with an `href` is a
 * link; one without is the organization's switch; no action leaves only the quieter link.
 */
export function instantEvalRefusalCopy(refusal: InstantEvalRefusal): {
  title: string;
  body: string;
  action?: { label: string; href?: string };
  /** A second, quieter link beside the action, when the copy has one. */
  more?: { label: string; href: string };
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
    // No judge, or a judge that is down: the reader's own model settings fix neither.
    return {
      title: "Instant Evals can't run right now",
      body: `${meanwhile} If it keeps happening, contact us.`,
      action: { label: "Contact us", href: CONTACT_US_HREF },
      dismiss: "Skip",
    };
  }
  const whereItGoes =
    "Instant Evals send the text of your traces and your question to the model that judges them, under a data processing agreement. It is never used to train the model.";
  if (refusal.kind === "opt_in") {
    return {
      title: "Turn on Instant Evals for your organization",
      body: `${whereItGoes} Enable turns this on for every project in your organization.`,
      action: { label: "Enable" },
      more: { label: "Read more", href: WHERE_THE_TEXT_GOES_HREF },
      dismiss: "Not now",
    };
  }
  if (refusal.kind === "ask_admin") {
    return {
      title: "Instant Evals aren't turned on for your organization yet",
      body: `${whereItGoes} Ask an organization admin to turn it on for every project in your organization.`,
      more: { label: "Read more", href: WHERE_THE_TEXT_GOES_HREF },
      dismiss: "Not now",
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
  onEnable,
  isEnabling,
  children,
}: InstantEvalRefusalPopoverProps) {
  const copy = refusal ? instantEvalRefusalCopy(refusal) : null;
  const action = copy?.action;
  const actionHref = action?.href;
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
                {action && actionHref === undefined && (
                  <Button
                    size="xs"
                    flex={1}
                    bg="orange.solid"
                    color="white"
                    _hover={{ bg: "orange.fg" }}
                    onClick={onEnable}
                    loading={isEnabling}
                  >
                    {action.label}
                  </Button>
                )}
                {action && actionHref !== undefined && (
                  <RoutedLink
                    href={actionHref}
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
                      {action.label}
                    </Button>
                  </RoutedLink>
                )}
                {copy.more && (
                  <RoutedLink href={copy.more.href} target="_blank" rel="noopener noreferrer">
                    <Button size="xs" variant="outline">
                      {copy.more.label}
                    </Button>
                  </RoutedLink>
                )}
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

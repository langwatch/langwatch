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
import {
  isSupportChatAvailable,
  toggleSupportChat,
} from "~/utils/crispBubblePolicy";
import { docsUrl } from "~/utils/docsUrl";

/**
 * Why an Instant Eval did not start, and what the popover says about it.
 *
 * `opt_in`, `ask_admin` and `unreleased` are the same refusal, an
 * organization Instant Evals are not on for, told to three readers: a member
 * who may manage a self-serve organization is offered the switch, a member
 * who may not is told where the text would go and to ask an organization
 * admin, and an enterprise organization or a self-hosted install is offered a
 * word with us.
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

/**
 * Where a project without Instant Evals asks for it to be switched on, when
 * there is no support chat to open instead.
 */
export const CONTACT_US_HREF =
  "mailto:support@langwatch.ai?subject=Please%20enable%20Instant%20Evals";

/** The docs paragraph that says where the judged text goes. */
export const WHERE_THE_TEXT_GOES_HREF = docsUrl(
  "/features/instant-evals/limits-and-cost#where-the-judged-text-goes",
);

interface InstantEvalRefusalPopoverProps {
  refusal: InstantEvalRefusal | null;
  /**
   * Closing, by the X, a click outside or the secondary button: for budget
   * and model refusals the phrase search then runs; for an organization
   * Instant Evals are not on for there is no sentence to fall back to, so
   * this only closes the popover.
   */
  onClose: () => void;
  /**
   * The organization's switch. Pressed by the `opt_in` popover only, and
   * required all the same: an Enable button whose click did nothing would
   * be the one refusal the popover cannot explain.
   */
  onEnable: () => void;
  isEnabling: boolean;
  children: React.ReactElement;
}

/**
 * The popover's words, exported so the copy is pinned by a test. An action
 * with an `href` is a link; one without is the organization's switch, a
 * button; no action at all leaves only the quieter link and the dismissal,
 * for the reader who may do nothing here but read. The render branches on
 * that rather than on the refusal kind.
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
    return {
      title: "Configure a model to judge results",
      body: `${what} Configure a model to run it. ${meanwhile}`,
      action: { label: "Configure a model", href: MODEL_PROVIDERS_HREF },
      dismiss: "Skip",
    };
  }
  const whereItGoes =
    "To judge results, LangWatch sends the text of your traces and your question to TypeSafe's model, under our data processing agreement with them. It is never used to train the model.";
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

/**
 * The refusal an Instant Eval met, anchored to the search bar: what the eval
 * would have found here, why it did not run, and the one thing that lifts
 * it. Closable every way. A spent budget or a missing judge falls back to
 * the phrase search, so neither is ever an error state on the page; an
 * organization Instant Evals are not on for has no phrase to fall back to,
 * so this is also its advertisement for the feature, and closing it just
 * leaves the typed chip where the reader put it.
 *
 * The `opt_in` popover is the explanation the organization reads before it
 * switches Instant Evals on: where the judged text goes, under what
 * agreement, and that it is never trained on. "Enable" throws the switch;
 * "Read more" opens the docs paragraph that says the same at length. The
 * `ask_admin` popover is the same explanation for a member who may not
 * throw the switch, with no button the server would refuse.
 *
 * "Contact us" on the unreleased popover opens the support chat when one is
 * available, and falls back to a mailto link otherwise: the copy names
 * neither route, so it reads the same either way.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("A refusal is a
 * popover, never an error state").
 */
export const InstantEvalRefusalPopover: React.FC<
  InstantEvalRefusalPopoverProps
> = ({ refusal, onClose, onEnable, isEnabling, children }) => {
  const copy = refusal ? instantEvalRefusalCopy(refusal) : null;
  const useSupportChat =
    refusal?.kind === "unreleased" && isSupportChatAvailable();
  const action = copy?.action;
  const actionHref = action?.href;
  const isSwitch = action !== undefined && actionHref === undefined;
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
                {action && (isSwitch || useSupportChat) && (
                  <Button
                    size="xs"
                    flex={1}
                    bg="orange.solid"
                    color="white"
                    _hover={{ bg: "orange.fg" }}
                    onClick={isSwitch ? onEnable : toggleSupportChat}
                    loading={isSwitch && isEnabling}
                  >
                    {action.label}
                  </Button>
                )}
                {action && actionHref !== undefined && !useSupportChat && (
                  <NextLink
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
                  </NextLink>
                )}
                {copy.more && (
                  <NextLink
                    href={copy.more.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="xs" variant="outline">
                      {copy.more.label}
                    </Button>
                  </NextLink>
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
};

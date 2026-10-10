import { Link as RoutedLink } from "@langwatch/browser-host/link";
/**
 * The refusal an Instant Eval met, anchored under the search bar: what the eval would have found,
 * why it did not run, and the one thing that lifts it. Closable every way.
 * @see specs/traces-v2/instant-eval-search.feature ("A refusal is a popover, never an error state")
 */
import { AccessState } from "@langwatch/design-system/access-state";
import {
  PopoverAnchor,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
} from "@langwatch/design-system/popover";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { ExplorerSelfHostedInstantEvalOffer } from "@langwatch/trace-contract";
import { Sparkles } from "lucide-react";
import type React from "react";

/**
 * Why an Instant Eval did not start. `opt_in`, `ask_admin` and `unreleased` are one refusal told to
 * three readers: the switch, an admin, or (enterprise) a word with us. A self-hosted install is
 * told its own reason, one kind per remedy: license, admin switch, connection or operator.
 */
export type InstantEvalRefusal =
  | { kind: "budget" }
  | { kind: "model" }
  | { kind: "opt_in" }
  | { kind: "ask_admin" }
  | { kind: "unreleased" }
  | { kind: ExplorerSelfHostedInstantEvalOffer };

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

/** The docs section on how a self-hosted install judges through LangWatch. */
export const SELF_HOSTED_INSTANT_EVALS_HREF =
  "https://docs.langwatch.ai/self-hosting/connect#instant-evals-through-connect";

/** Where an organization admin switches hosted judging back on. */
export const CONNECT_SETTINGS_HREF = "/settings/connect";

/** The two addresses a self-hosted install judges through. */
const CONNECT_HOSTS = "connect.langwatch.ai and gateway.langwatch.ai";

interface InstantEvalRefusalPopoverProps {
  refusal: InstantEvalRefusal | null;
  /** The X, a click outside or the secondary button. */
  onClose: () => void;
  /** The organization's switch, pressed by the `opt_in` popover only. */
  onEnable: () => void;
  isEnabling: boolean;
  /** The install judges through LangWatch: "can't run right now" then names the two addresses. */
  viaConnect?: boolean;
  children: React.ReactElement;
}

interface InstantEvalRefusalCopy {
  title: string;
  body: string;
  action?: { label: string; href?: string };
  /** A second, quieter link beside the action, when the copy has one. */
  more?: { label: string; href: string };
  dismiss: string;
}

const READ_MORE_SELF_HOSTED = { label: "Read more", href: SELF_HOSTED_INSTANT_EVALS_HREF };

/**
 * A self-hosted refusal, keyed by the server's offer so a fifth offer fails the typecheck rather
 * than falling through to the enterprise copy. Only a license gap offers a word with us: the other
 * three are fixed on the install, by an admin, its network or its operator.
 */
const SELF_HOSTED_REFUSAL_COPY: Record<ExplorerSelfHostedInstantEvalOffer, InstantEvalRefusalCopy> =
  {
    not_in_license: {
      title: "Your license doesn't include Instant Evals",
      body: "Instant Evals turn plain language questions into native filters. On a self-hosted install they come with a license that includes them. Contact us to add them.",
      action: { label: "Contact us", href: CONTACT_US_HREF },
      more: READ_MORE_SELF_HOSTED,
      dismiss: "Not now",
    },
    switched_off: {
      title: "Instant Evals are switched off for your organization",
      body: "Your license includes Instant Evals, and an organization admin switched them off. An admin can switch them back on in Settings, Connect.",
      action: { label: "Open Connect settings", href: CONNECT_SETTINGS_HREF },
      dismiss: "Not now",
    },
    not_connected: {
      // Not "can't reach": an operator who switched Connect off on purpose gets this one too.
      title: "This install isn't connected to LangWatch",
      body: `Instant Evals on a self-hosted install judge through LangWatch. The install needs Connect switched on and ${CONNECT_HOSTS} reachable.`,
      more: READ_MORE_SELF_HOSTED,
      dismiss: "Not now",
    },
    ask_operator: {
      title: "Instant Evals are off on this install",
      body: "This install doesn't judge through LangWatch, so whoever runs it decides when Instant Evals are on. Ask them to switch Instant Evals on.",
      more: READ_MORE_SELF_HOSTED,
      dismiss: "Not now",
    },
  };

/** Whether a refusal kind, or the server's offer, is a self-hosted one; the record is the list. */
export function isSelfHostedRefusal(
  kind: string | undefined,
): kind is ExplorerSelfHostedInstantEvalOffer {
  return kind !== undefined && Object.hasOwn(SELF_HOSTED_REFUSAL_COPY, kind);
}

/**
 * The popover's words, exported so the copy is pinned by a test. An action with an `href` is a
 * link; one without is the organization's switch; no action leaves only the quieter link.
 */
export function instantEvalRefusalCopy(
  refusal: InstantEvalRefusal,
  { viaConnect = false }: { viaConnect?: boolean } = {},
): InstantEvalRefusalCopy {
  const what =
    "An Instant Eval reads every result in this view and keeps the ones that answer your question, which no filter can do.";
  const meanwhile = "The words are searched as a phrase in the meantime.";
  if (refusal.kind === "budget") {
    return {
      title: "Your free Instant Evals quota is used up",
      body: `${what} Upgrade to keep judging. ${meanwhile}`,
      action: { label: "Compare plans", href: UPGRADE_HREF },
      dismiss: "Skip",
    };
  }
  if (refusal.kind === "model") {
    // No judge, or a judge that is down: the reader's own model settings fix neither. An install
    // judging through LangWatch may just not be reaching it, which its operator can check first.
    const network = viaConnect
      ? ` This install judges through LangWatch, so check that it can reach ${CONNECT_HOSTS}.`
      : "";
    return {
      title: "Instant Evals can't run right now",
      body: `${meanwhile}${network} If it keeps happening, contact us.`,
      action: { label: "Contact us", href: CONTACT_US_HREF },
      dismiss: "Skip",
    };
  }
  if (isSelfHostedRefusal(refusal.kind)) {
    return SELF_HOSTED_REFUSAL_COPY[refusal.kind];
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
  viaConnect,
  children,
}: InstantEvalRefusalPopoverProps) {
  const copy = refusal ? instantEvalRefusalCopy(refusal, { viaConnect }) : null;
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
          {copy &&
          actionHref &&
          (refusal?.kind === "budget" || refusal?.kind === "not_in_license") ? (
            <AccessState
              kind="upgrade"
              compact
              title={copy.title}
              description={copy.body}
              actions={
                <>
                  <Button asChild size="sm" colorPalette="orange">
                    <RoutedLink href={actionHref}>{action?.label}</RoutedLink>
                  </Button>
                  <Button size="sm" variant="outline" onClick={onClose}>
                    {copy.dismiss}
                  </Button>
                  {copy.more && (
                    <RoutedLink href={copy.more.href} target="_blank" rel="noopener noreferrer">
                      {copy.more.label}
                    </RoutedLink>
                  )}
                </>
              }
            />
          ) : (
            copy && (
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
                      colorPalette="orange"
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
                      <Button size="xs" width="full" colorPalette="orange">
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
            )
          )}
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}

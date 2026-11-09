import { EnterpriseLock } from "@langwatch/browser-host/enterprise-lock";
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

import { DecisionModelPicker } from "./decision-model-picker.tsx";

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

/**
 * Every refusal but a broken judge gates LangWatch's own model only: a project on its own decision
 * model, picked in Default models, runs whatever the release, plan or license says (ADR-182).
 */
export const OWN_MODEL_LINK = {
  label: "Run them on your own decision model",
  href: MODEL_PROVIDERS_HREF,
} as const;

/** What an Instant Eval does, said once on the Enterprise lock. */
const INSTANT_EVALS_DESCRIPTION =
  "Ask your traces a question in plain language and keep only the results that answer it.";

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
  /** A click outside or Escape: the popover closes and the eval chip stays. */
  onClose: () => void;
  /** The secondary button when it reads "Skip": the words are routed again without the eval. */
  onSkip: () => void;
  /** The organization's switch, pressed by the `opt_in` popover only. */
  onEnable: () => void;
  isEnabling: boolean;
  /** The install judges through LangWatch: "can't run right now" then names the two addresses. */
  viaConnect?: boolean;
  /** The reader may manage the organization, so the license lock offers the License page. */
  canActivateLicense?: boolean;
  /** The own-decision-model kill switch is on, so Default models can pick one: offer it. */
  offersOwnModel?: boolean;
  /** The project's runnable decision models, for the in-place picker; undefined while loading. */
  decisionModels?: readonly { value: string; label: string }[] | undefined;
  /** Saves the picked model as the project's Instant Evals default, then runs the eval. */
  onPickDecisionModel?: (model: string) => void;
  /** The model being saved, if any. */
  pickingDecisionModel?: string | null;
  children: React.ReactElement;
}

interface InstantEvalRefusalCopy {
  title: string;
  body: string;
  action?: { label: string; href?: string };
  /** A second, quieter link beside the action, when the copy has one. */
  more?: { label: string; href: string };
  /** The way round a gate on LangWatch's own model: the project's own decision model. */
  ownModel?: { label: string; href: string };
  /** The decision model is picked in place, under the body. */
  picker?: true;
  dismiss: string;
}

/** The license gap: the Enterprise lock owns its words; the entry holds what sits beside it. */
interface InstantEvalLicenseLockCopy {
  lock: "license";
  more: { label: string; href: string };
  ownModel: { label: string; href: string };
  dismiss: string;
}

const READ_MORE_SELF_HOSTED = { label: "Read more", href: SELF_HOSTED_INSTANT_EVALS_HREF };

/**
 * A self-hosted refusal, keyed by the server's offer so a fifth offer fails the typecheck rather
 * than falling through to the enterprise copy. Only a license gap offers a word with us: the other
 * three are fixed on the install, by an admin, its network or its operator.
 */
const SELF_HOSTED_REFUSAL_COPY: { not_in_license: InstantEvalLicenseLockCopy } & Record<
  Exclude<ExplorerSelfHostedInstantEvalOffer, "not_in_license">,
  InstantEvalRefusalCopy
> = {
  // Also the answer with no license at all, so it never says what a license holds.
  not_in_license: {
    lock: "license",
    more: READ_MORE_SELF_HOSTED,
    ownModel: OWN_MODEL_LINK,
    dismiss: "Not now",
  },
  switched_off: {
    title: "Instant Evals are switched off for your organization",
    body: "Your license includes Instant Evals, and an organization admin switched them off. An admin can switch them back on in Settings, Connect.",
    action: { label: "Open Connect settings", href: CONNECT_SETTINGS_HREF },
    ownModel: OWN_MODEL_LINK,
    dismiss: "Not now",
  },
  not_connected: {
    // Not "can't reach": an operator who switched Connect off on purpose gets this one too.
    title: "This install isn't connected to LangWatch",
    body: `Instant Evals on a self-hosted install judge through LangWatch. The install needs Connect switched on and ${CONNECT_HOSTS} reachable.`,
    more: READ_MORE_SELF_HOSTED,
    ownModel: OWN_MODEL_LINK,
    dismiss: "Not now",
  },
  ask_operator: {
    title: "Instant Evals are off on this install",
    body: "This install doesn't judge through LangWatch, so whoever runs it decides when Instant Evals are on. Ask them to switch Instant Evals on.",
    more: READ_MORE_SELF_HOSTED,
    ownModel: OWN_MODEL_LINK,
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
  {
    viaConnect = false,
    offersOwnModel = false,
  }: { viaConnect?: boolean; offersOwnModel?: boolean } = {},
): InstantEvalRefusalCopy | InstantEvalLicenseLockCopy {
  const what =
    "An Instant Eval reads every result in this view and keeps the ones that answer your question, which no filter can do.";
  const skip = "Skip searches your words without the eval.";
  if (refusal.kind === "budget") {
    return {
      title: "Your free Instant Evals quota is used up",
      body: `${what} Upgrade to keep judging. ${skip}`,
      action: { label: "Compare plans", href: UPGRADE_HREF },
      ownModel: OWN_MODEL_LINK,
      dismiss: "Skip",
    };
  }
  if (refusal.kind === "model") {
    // No judge, or a judge that is down: the reader's own model settings fix neither. An install
    // judging through LangWatch may just not be reaching it, which its operator can check first.
    const network = viaConnect
      ? `This install judges through LangWatch, so check that it can reach ${CONNECT_HOSTS}. `
      : "";
    return {
      title: "Instant Evals can't run right now",
      body: `${network}${skip} If it keeps happening, contact us.`,
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
      ownModel: OWN_MODEL_LINK,
      dismiss: "Not now",
    };
  }
  if (refusal.kind === "ask_admin") {
    return {
      title: "Instant Evals aren't turned on for your organization yet",
      body: `${whereItGoes} Ask an organization admin to turn it on for every project in your organization.`,
      more: { label: "Read more", href: WHERE_THE_TEXT_GOES_HREF },
      ownModel: OWN_MODEL_LINK,
      dismiss: "Not now",
    };
  }
  const powerful =
    "Instant Evals are a powerful new tool that turns plain language questions into native filters.";
  // Without LangWatch's own model, the project's own decision model is the way in: no word with us.
  if (offersOwnModel) {
    return {
      title: "Pick a decision model",
      body: "Instant Evals run on a decision model of your own.",
      picker: true,
      dismiss: "Not now",
    };
  }
  return {
    title: "Instant Evals aren't enabled for this project yet",
    body: `${powerful} Contact us so we can activate Evals Preview, our hosted model, for you.`,
    action: { label: "Contact us", href: CONTACT_US_HREF },
    ownModel: OWN_MODEL_LINK,
    dismiss: "Not now",
  };
}

export function InstantEvalRefusalPopover({
  refusal,
  onClose,
  onSkip,
  onEnable,
  isEnabling,
  viaConnect,
  canActivateLicense = false,
  offersOwnModel = false,
  decisionModels,
  onPickDecisionModel,
  pickingDecisionModel = null,
  children,
}: InstantEvalRefusalPopoverProps) {
  const refusalCopy = refusal
    ? instantEvalRefusalCopy(refusal, { viaConnect, offersOwnModel })
    : null;
  const lockCopy = refusalCopy && "lock" in refusalCopy ? refusalCopy : null;
  const copy = refusalCopy && !("lock" in refusalCopy) ? refusalCopy : null;
  const action = copy?.action;
  const actionHref = action?.href;
  // Only a button that says Skip routes the words again; "Not now" just closes.
  const onDismiss = copy?.dismiss === "Skip" ? onSkip : onClose;
  const licenseLock = lockCopy ? (
    <EnterpriseLock
      compact
      feature="Instant Evals"
      description={INSTANT_EVALS_DESCRIPTION}
      canManage={canActivateLicense}
      data-testid="instant-eval-enterprise-lock"
      extraActions={
        <>
          <Button size="xs" variant="ghost" onClick={onDismiss}>
            {lockCopy.dismiss}
          </Button>
          <RoutedLink href={lockCopy.more.href} target="_blank" rel="noopener noreferrer">
            {lockCopy.more.label}
          </RoutedLink>
          <OwnModelLink link={offersOwnModel ? lockCopy.ownModel : undefined} />
        </>
      }
    />
  ) : null;
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
          {licenseLock ??
            (copy && actionHref && refusal?.kind === "budget" ? (
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
                    <Button size="sm" variant="outline" onClick={onDismiss}>
                      {copy.dismiss}
                    </Button>
                    {copy.more && (
                      <RoutedLink href={copy.more.href} target="_blank" rel="noopener noreferrer">
                        {copy.more.label}
                      </RoutedLink>
                    )}
                    <OwnModelLink link={offersOwnModel ? copy.ownModel : undefined} />
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
                  <OwnModelLink link={offersOwnModel ? copy.ownModel : undefined} />
                  {copy.picker && onPickDecisionModel && (
                    <DecisionModelPicker
                      pickable={decisionModels}
                      onPick={onPickDecisionModel}
                      picking={pickingDecisionModel}
                      configureHref={MODEL_PROVIDERS_HREF}
                    />
                  )}
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
                    <Button size="xs" variant="ghost" onClick={onDismiss}>
                      {copy.dismiss}
                    </Button>
                  </HStack>
                </VStack>
              )
            ))}
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}

/** The quiet link to Default models, where a project picks its own decision model. */
function OwnModelLink({ link }: { link: { label: string; href: string } | undefined }) {
  if (!link) return null;
  return (
    <Text textStyle="xs">
      <RoutedLink
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="instant-eval-own-model-link"
      >
        {link.label}
      </RoutedLink>
    </Text>
  );
}

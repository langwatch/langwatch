import { Link as RoutedLink } from "@langwatch/browser-host/link";
/**
 * The refusal an Instant Eval met, anchored under the search bar: what the eval would have found,
 * why it did not run, and the one thing that lifts it. Closable every way.
 * @see specs/traces-v2/instant-eval-search.feature ("A refusal is a popover, never an error state")
 */
import { AccessState } from "@langwatch/design-system/access-state";
import { Card } from "@langwatch/design-system/card";
import {
  PopoverAnchor,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
} from "@langwatch/design-system/popover";
import {
  Badge,
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type { ExplorerSelfHostedInstantEvalOffer } from "@langwatch/trace-contract";
import { Check, Copy, KeyRound, Sparkles } from "lucide-react";
import type React from "react";
import { useState } from "react";

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

/** What an Instant Eval does, said once above the two ways to turn them on. */
const INSTANT_EVALS_DESCRIPTION =
  "Ask your traces a question in plain language and keep only the results that answer it. Pick how it judges.";

/** Where an admin adds a decision model key: Model providers, with the Instant Evals picker
 *  open. */
export const INSTANT_EVALS_SETUP_HREF = "/settings/model-providers?setup=instant-evals";

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
  /** The reader may manage the organization, so the self-hosted ways in carry their buttons. */
  canManageOrganization?: boolean;
  /** The own-decision-model kill switch is on, so Default models can pick one: offer it. */
  offersOwnModel?: boolean;
  /** The reader may set the project's default models, so the decision model is picked in place. */
  canPickDecisionModel?: boolean;
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

/**
 * A self-hosted install without hosted judging: the two ways to turn Instant Evals on, LangWatch
 * Instant (preview) through Connect, and (when offered) the project's own decision model.
 */
interface InstantEvalTurnOnCopy {
  turnOn: true;
  title: string;
  body: string;
  hosted: { title: string; body: string; action: { label: string; href: string } };
  ownModel?: { title: string; body: string; action: { label: string; href: string } };
  more: { label: string; href: string };
  dismiss: string;
}

/** The two ways in, said the same whichever reason kept hosted judging off. */
const TURN_ON_COPY: InstantEvalTurnOnCopy = {
  turnOn: true,
  title: "Turn on Instant Evals",
  body: INSTANT_EVALS_DESCRIPTION,
  hosted: {
    title: "LangWatch Instant (preview)",
    body: "Runs on LangWatch Cloud. Connect this install to your LangWatch organization and add credits. You pay per eval.",
    action: { label: "Connect to LangWatch", href: CONNECT_SETTINGS_HREF },
  },
  ownModel: {
    title: "Your own decision model",
    body: "OpenAI, Perplexity, Inception, Cloudflare or TypeSafe. Paste a key and it becomes the default. You pay the provider.",
    action: { label: "Add a key", href: INSTANT_EVALS_SETUP_HREF },
  },
  more: { label: "How Instant Evals work", href: SELF_HOSTED_INSTANT_EVALS_HREF },
  dismiss: "Not now",
};

/**
 * A self-hosted refusal, keyed by the server's offer so a fifth offer fails the typecheck rather
 * than falling through to the enterprise copy. No license gap, missing connection or operator
 * choice is a wall: each offers the two ways in. Only an admin's own switch is told apart.
 */
const SELF_HOSTED_REFUSAL_COPY: Record<
  Exclude<ExplorerSelfHostedInstantEvalOffer, "switched_off">,
  InstantEvalTurnOnCopy
> & { switched_off: InstantEvalRefusalCopy } = {
  not_in_license: TURN_ON_COPY,
  not_connected: TURN_ON_COPY,
  ask_operator: TURN_ON_COPY,
  switched_off: {
    title: "Instant Evals are switched off for your organization",
    body: "Your license includes Instant Evals, and an organization admin switched them off. An admin can switch them back on in Settings, Connect.",
    action: { label: "Open Connect settings", href: CONNECT_SETTINGS_HREF },
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

type RefusalCopyOptions = {
  viaConnect?: boolean;
  offersOwnModel?: boolean;
  canPickDecisionModel?: boolean;
};

/**
 * The popover's words, exported so the copy is pinned by a test. An action with an `href` is a
 * link; one without is the organization's switch; no action leaves only the quieter link. The
 * own-model link is left out while the own-model switch is off.
 */
export function instantEvalRefusalCopy(
  refusal: InstantEvalRefusal,
  options: RefusalCopyOptions = {},
): InstantEvalRefusalCopy | InstantEvalTurnOnCopy {
  const copy = refusalCopyFor(refusal, options);
  if (options.offersOwnModel || !copy.ownModel) return copy;
  const { ownModel: _hidden, ...withoutOwnModel } = copy;
  return withoutOwnModel;
}

function refusalCopyFor(
  refusal: InstantEvalRefusal,
  { viaConnect = false, offersOwnModel = false, canPickDecisionModel = false }: RefusalCopyOptions,
): InstantEvalRefusalCopy | InstantEvalTurnOnCopy {
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
  if (offersOwnModel && canPickDecisionModel) {
    return {
      title: "Pick a decision model",
      body: "Instant Evals run on a decision model of your own.",
      picker: true,
      dismiss: "Not now",
    };
  }
  // Picking one writes the project's default models, which only a project admin may do.
  if (offersOwnModel) {
    return {
      title: "Instant Evals need a decision model",
      body: "Instant Evals run on a decision model of your own. Ask a project admin to pick one in Default models.",
      ownModel: OWN_MODEL_LINK,
      dismiss: "Not now",
    };
  }
  return {
    title: "Instant Evals aren't enabled for this project yet",
    body: `${powerful} Contact us so we can activate LangWatch Instant (preview), our hosted model, for you.`,
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
  canManageOrganization = false,
  offersOwnModel = false,
  canPickDecisionModel = false,
  decisionModels,
  onPickDecisionModel,
  pickingDecisionModel = null,
  children,
}: InstantEvalRefusalPopoverProps) {
  const refusalCopy = refusal
    ? instantEvalRefusalCopy(refusal, { viaConnect, offersOwnModel, canPickDecisionModel })
    : null;
  const turnOnCopy = refusalCopy && "turnOn" in refusalCopy ? refusalCopy : null;
  const copy = refusalCopy && !("turnOn" in refusalCopy) ? refusalCopy : null;
  const action = copy?.action;
  const actionHref = action?.href;
  // Only a button that says Skip routes the words again; "Not now" just closes.
  const onDismiss = copy?.dismiss === "Skip" ? onSkip : onClose;
  const turnOn = turnOnCopy ? (
    <TurnOnInstantEvals
      copy={turnOnCopy}
      canManageOrganization={canManageOrganization}
      onDismiss={onClose}
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
      <PopoverContent
        width={turnOn ? "420px" : undefined}
        maxWidth={turnOn ? "calc(100vw - 32px)" : "360px"}
        data-testid="instant-eval-refusal"
      >
        <PopoverArrow />
        <PopoverBody>
          {turnOn ??
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
                    <OwnModelLink link={copy.ownModel} />
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
                  <OwnModelLink link={copy.ownModel} />
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

/**
 * One way to turn Instant Evals on: what it is, who pays, and its button for an admin. A
 * recommended option carries the "Recommended" badge and the one solid button.
 */
function TurnOnOption({
  option,
  icon,
  isRecommended = false,
  canAct,
  testId,
}: {
  option: { title: string; body: string; action: { label: string; href: string } };
  icon: React.ReactNode;
  isRecommended?: boolean;
  canAct: boolean;
  testId: string;
}) {
  return (
    <Card
      variant="nested"
      padding="sm"
      icon={icon}
      title={option.title}
      badge={
        isRecommended ? (
          <Badge size="sm" colorPalette="orange" variant="subtle">
            Recommended
          </Badge>
        ) : undefined
      }
      description={option.body}
      footer={
        canAct ? (
          <Button
            asChild
            size="xs"
            colorPalette={isRecommended ? "orange" : undefined}
            variant={isRecommended ? "solid" : "outline"}
          >
            {/* A new tab, so the typed query the popover keeps survives the detour. */}
            <RoutedLink href={option.action.href} target="_blank" rel="noopener noreferrer">
              {option.action.label}
            </RoutedLink>
          </Button>
        ) : undefined
      }
      footerDivider={false}
      data-testid={testId}
    />
  );
}

/**
 * The self-hosted way in: LangWatch Instant (preview) first, then the own decision model. A
 * reader who may not manage the organization sees both, and a link to send an admin.
 */
function TurnOnInstantEvals({
  copy,
  canManageOrganization,
  onDismiss,
}: {
  copy: InstantEvalTurnOnCopy;
  canManageOrganization: boolean;
  onDismiss: () => void;
}) {
  return (
    <VStack align="stretch" gap={3} data-testid="instant-eval-turn-on">
      <VStack align="stretch" gap={1}>
        <Text textStyle="sm" fontWeight="semibold">
          {copy.title}
        </Text>
        <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
          {copy.body}
        </Text>
      </VStack>
      <TurnOnOption
        option={copy.hosted}
        icon={<Sparkles size={16} />}
        isRecommended
        canAct={canManageOrganization}
        testId="instant-eval-turn-on-hosted"
      />
      {copy.ownModel && (
        <TurnOnOption
          option={copy.ownModel}
          icon={<KeyRound size={16} />}
          canAct={canManageOrganization}
          testId="instant-eval-turn-on-own-model"
        />
      )}
      {!canManageOrganization && <AskAnAdmin href={(copy.ownModel ?? copy.hosted).action.href} />}
      <HStack gap={2}>
        <Text textStyle="xs">
          <RoutedLink href={copy.more.href} target="_blank" rel="noopener noreferrer">
            {copy.more.label}
          </RoutedLink>
        </Text>
        <Spacer />
        <Button size="xs" variant="ghost" onClick={onDismiss}>
          {copy.dismiss}
        </Button>
      </HStack>
    </VStack>
  );
}

/**
 * What a member sees in place of the buttons: who can act, and a link to send them. Without
 * clipboard access the address stays on screen, selectable, with a line saying to copy it by hand.
 */
function AskAnAdmin({ href }: { href: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const address = typeof window === "undefined" ? href : `${window.location.origin}${href}`;
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  const copied = copyState === "copied";
  return (
    <VStack align="stretch" gap={1} data-testid="instant-eval-ask-admin">
      <Text textStyle="xs" fontWeight="medium">
        Only an admin can turn this on
      </Text>
      <HStack gap={2}>
        <Text
          textStyle="xs"
          color="fg.muted"
          fontFamily="mono"
          truncate={copyState !== "failed"}
          wordBreak="break-all"
          userSelect="all"
          flex={1}
          minWidth={0}
          data-testid="instant-eval-ask-admin-address"
        >
          {address}
        </Text>
        <Button size="xs" variant="outline" onClick={() => void copy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </HStack>
      <Text textStyle="xs" color="fg.muted">
        {copyState === "failed"
          ? "Couldn't copy it. Select the link above and send it to an admin."
          : "Send it to an admin so they can turn it on."}
      </Text>
    </VStack>
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

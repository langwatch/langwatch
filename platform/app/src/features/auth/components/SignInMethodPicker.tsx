import { Alert, Badge, HStack, Text, VStack } from "@chakra-ui/react";
import type { SignInMethod } from "@langwatch/identity";
import type { ReactNode } from "react";
import { signInMethodActionLabel } from "../logic/methodLabels";
import { rankMethodsForBrowser } from "../logic/methodRanking";
import { useOtherMethodsStandBack } from "../logic/passkeyCeremony";
import { signInRoutingReasonCopy } from "../logic/routingReasonCopy";
import "../auth.css";
import { MONO_FONT } from "../authTheme";
import { MethodButton } from "./MethodButton";
import { PasskeySignInButton } from "./PasskeySignInButton";
import { SignInMethodIcon } from "./SignInMethodIcon";

/**
 * A development stack rarely has social credentials mounted, so its routing
 * decision offers none of them — which would hide the whole social rail from
 * exactly the people iterating on it. In dev the rail shows the cloud's full
 * social set, wired to the real sign-in call; everywhere else the rail is
 * exactly what the decision offered.
 */
const DEV_SHOWS_ALL_SOCIAL = import.meta.env.DEV;

/** The cloud's social set. Ids are the real provider ids, so a click dials
 *  the real provider and the marks and labels are the real ones. */
const SOCIAL_METHODS: readonly SignInMethod[] = [
  { id: "google", kind: "federated", connectionId: null },
  { id: "github", kind: "federated", connectionId: null },
  { id: "azure-ad", kind: "federated", connectionId: null },
];

/**
 * The method picker: exactly the methods the routing decision named, in the
 * order it named them, with the words its reason code is worth (ADR-117 §2,
 * §6).
 *
 * It holds no routing logic and reads nothing about the person. Two visitors
 * whose addresses produce the same decision see the same picker, because the
 * decision is all this component is given — there is nothing else here for
 * them to differ by. The one thing that varies is the "Last used" badge, which
 * is this BROWSER's memory of a method id and knows nothing about accounts.
 *
 * Sign-in and sign-up both render this component. What a LOCAL method means
 * differs between them (a password to type, a password to choose), so each
 * supplies that part; everything else, including which methods exist at all,
 * is the decision's answer rather than the screen's.
 */
export function SignInMethodPicker({
  methodSet,
  reasonCode,
  lastUsedMethodId,
  onFederatedMethodChosen,
  renderLocalMethod,
  callbackUrl,
  onPasskeyError,
  autoStartPasskey,
  onPasskeyAutoStarted,
  onPasskeyDeclined,
}: {
  methodSet: readonly SignInMethod[];
  reasonCode: string;
  /** The method this browser last got in with, badged where it appears. */
  lastUsedMethodId?: string | null;
  onFederatedMethodChosen: (method: SignInMethod) => void;
  renderLocalMethod?: (method: SignInMethod) => ReactNode;
  /** Where a completed ceremony lands. The passkey seat dials for itself. */
  callbackUrl?: string;
  /** A refused ceremony, sent to the card's one alert at the top. */
  onPasskeyError: (error: unknown) => void;
  /**
   * Start the passkey ceremony as soon as the rail appears, because the
   * identifier submit that produced this decision was the gesture asking for
   * it (ADR-117, revision 2026-08-25). Set only by a screen that knows the
   * decision is about an ACCOUNT — see `shouldStartPasskeyOnArrival`.
   */
  autoStartPasskey?: boolean;
  /** The automatic ceremony has begun. Told to the screen, which is the only
   *  thing that outlives the card being taken over by the panel. */
  onPasskeyAutoStarted?: () => void;
  /** The auto-started ceremony ended without a session. */
  onPasskeyDeclined?: () => void;
}) {
  const guidance = signInRoutingReasonCopy(reasonCode);
  // The server's ranking, with this browser's own last-used method promoted
  // over it. One promotion, never a re-sort — see `rankMethodsForBrowser`.
  const ordered = rankMethodsForBrowser({ methodSet, lastUsedMethodId });

  return (
    <VStack width="full" align="stretch" gap={4} data-testid="method-picker">
      {guidance ? (
        <Alert.Root
          status="info"
          borderStartWidth="4px"
          borderStartColor="colorPalette.solid"
        >
          <Alert.Content>
            <Alert.Title>{guidance.title}</Alert.Title>
            <Alert.Description>{guidance.describe}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}

      {ordered.length === 0 ? (
        <Text>
          There is no way to sign in to this installation yet. Ask whoever runs
          it to set one up.
        </Text>
      ) : null}

      {ordered.map((method) => (
        <MethodEntry
          key={`${method.kind}:${method.id}:${method.connectionId ?? ""}`}
          method={method}
          isLastUsed={lastUsedMethodId === method.id}
          onFederatedMethodChosen={onFederatedMethodChosen}
          renderLocalMethod={renderLocalMethod}
          callbackUrl={callbackUrl}
          onPasskeyError={onPasskeyError}
          autoStartPasskey={autoStartPasskey}
          onPasskeyAutoStarted={onPasskeyAutoStarted}
          onPasskeyDeclined={onPasskeyDeclined}
        />
      ))}
    </VStack>
  );
}

/**
 * Whether the address step has anything to offer under its "or" at all. The
 * divider is the caller's to draw, and a divider over nothing was the old
 * layout's orphan "OR": ask this before passing `alternatives`, and pass
 * nothing when the answer is no.
 */
export function hasAlternativeMethods(
  methodSet: readonly SignInMethod[],
): boolean {
  return (
    DEV_SHOWS_ALL_SOCIAL ||
    methodSet.some(
      (method) => method.kind === "federated" || method.kind === "passkey",
    )
  );
}

/**
 * The methods a person can take instead of typing an address: the instance's
 * federated methods, in the order the decision named them. Rendered under the
 * address step's divider on both doors, so the two screens offer the same
 * alternatives in the same order. Every button is live — a method appears
 * here because it can be dialed, or not at all.
 */
export function AlternativeMethods({
  methodSet,
  lastUsedMethodId,
  onFederatedMethodChosen,
  callbackUrl,
  onPasskeyError,
}: {
  methodSet: readonly SignInMethod[];
  lastUsedMethodId?: string | null;
  onFederatedMethodChosen: (method: SignInMethod) => void;
  callbackUrl?: string;
  /** A refused ceremony, sent to the card's one alert at the top. */
  onPasskeyError: (error: unknown) => void;
}) {
  const offered = methodSet.filter((method) => method.kind === "federated");
  const offeredIds = new Set(offered.map((method) => method.id));
  const methods = DEV_SHOWS_ALL_SOCIAL
    ? [
        ...offered,
        ...SOCIAL_METHODS.filter((method) => !offeredIds.has(method.id)),
      ]
    : offered;

  return (
    <VStack
      width="full"
      align="stretch"
      gap={3}
      data-testid="alternative-methods"
    >
      {/* First in the rail, and above the providers, because it is the only
          way in that asks for NOTHING — no address here, none at the step
          this rail sits under, and no second screen at the provider's end.
          A passkey names the account by itself, so ordering it under three
          hand-offs would be putting the longest routes in front of the
          shortest. It stays under the address field rather than over it: the
          address is what most people came to type. */}
      {methodSet.some((method) => method.kind === "passkey") ? (
        <PasskeySignInButton
          callbackUrl={callbackUrl}
          badge={lastUsedMethodId === "passkey" ? <LastUsedBadge /> : null}
          onError={onPasskeyError}
        />
      ) : null}
      {methods.map((method) => (
        <FederatedMethodButton
          key={method.id}
          method={method}
          isLastUsed={lastUsedMethodId === method.id}
          onChosen={onFederatedMethodChosen}
        />
      ))}
    </VStack>
  );
}

/**
 * One full-width button per federated method, marked and named the way the
 * provider is: the mark is what somebody scanning the screen looks for.
 */
export function FederatedMethodButton({
  method,
  isLastUsed,
  onChosen,
}: {
  method: SignInMethod;
  isLastUsed?: boolean;
  onChosen: (method: SignInMethod) => void;
}) {
  // Read here rather than passed down: every seat in the rail asks the same
  // store the ceremony publishes to, so none of them can be left behind by a
  // caller that forgot to thread a prop.
  const standBack = useOtherMethodsStandBack();

  return (
    <MethodButton
      icon={<SignInMethodIcon method={method} />}
      label={signInMethodActionLabel(method)}
      badge={isLastUsed ? <LastUsedBadge /> : null}
      isStandingBack={standBack}
      onClick={() => onChosen(method)}
    />
  );
}

export function LastUsedBadge() {
  return (
    <Badge
      // The site's own pill: a hairline ring on the ground colour, small
      // caps, muted ink. It floats over the button's top edge, so the solid
      // ground is load-bearing — it is what masks the border it crosses —
      // and the quiet register is the point: this is a memory of the
      // browser's, not a recommendation of ours.
      borderRadius="full"
      paddingX="8px"
      paddingY="1px"
      fontSize="9px"
      fontWeight={500}
      letterSpacing="0.14em"
      textTransform="uppercase"
      backgroundColor="auth.ground"
      borderWidth="1px"
      borderColor="auth.hairline"
      color="fg.muted"
      data-testid="last-used-method"
    >
      Last used
    </Badge>
  );
}

/** A thin "or" between the address step and the methods beside it, said the
 *  way the site says its small technical words: mono, spaced, quiet. */
export function MethodDivider() {
  return (
    <HStack width="full" gap="10px" paddingY="6px">
      <Divider />
      <Text
        fontFamily={MONO_FONT}
        fontSize="10px"
        textTransform="uppercase"
        letterSpacing="0.16em"
        color="fg.muted"
      >
        or
      </Text>
      <Divider />
    </HStack>
  );
}

function Divider() {
  return <div className="lw-auth-hairline" />;
}

function MethodEntry({
  method,
  isLastUsed,
  onFederatedMethodChosen,
  renderLocalMethod,
  callbackUrl,
  onPasskeyError,
  autoStartPasskey,
  onPasskeyAutoStarted,
  onPasskeyDeclined,
}: {
  method: SignInMethod;
  isLastUsed: boolean;
  onFederatedMethodChosen: (method: SignInMethod) => void;
  renderLocalMethod?: (method: SignInMethod) => ReactNode;
  callbackUrl?: string;
  onPasskeyError: (error: unknown) => void;
  autoStartPasskey?: boolean;
  onPasskeyAutoStarted?: () => void;
  onPasskeyDeclined?: () => void;
}) {
  if (method.kind === "federated") {
    return (
      <FederatedMethodButton
        method={method}
        isLastUsed={isLastUsed}
        onChosen={onFederatedMethodChosen}
      />
    );
  }

  // A passkey is local — this deployment authenticates it — but it is a
  // BUTTON, so it wears its badge floated on the seat the way the providers
  // do rather than stacked above it like a form. Drawn here rather than by
  // each door, so both doors offer it identically.
  if (method.kind === "passkey") {
    return (
      <PasskeySignInButton
        callbackUrl={callbackUrl}
        badge={isLastUsed ? <LastUsedBadge /> : null}
        autoStart={autoStartPasskey}
        onAutoStarted={onPasskeyAutoStarted}
        onError={onPasskeyError}
        onDeclined={onPasskeyDeclined}
      />
    );
  }

  const local = renderLocalMethod?.(method);
  if (local) {
    return <LocalMethodSlot isLastUsed={isLastUsed}>{local}</LocalMethodSlot>;
  }

  // A local method the screen has nothing to render for is still named, so
  // the picker never silently drops a method the decision offered.
  return <Text>{signInMethodActionLabel(method)}</Text>;
}

/**
 * The seat a whole FORM sits in — the password step, most often — and how it
 * stands back while another method's ceremony is running.
 *
 * A form cannot be dimmed the way a button can: it holds a field somebody
 * could still type into, a submit they could still press, and a "forgot
 * password" link they could still follow out of the page mid-ceremony. `inert`
 * is the primitive that means all of it at once — no pointer events, no focus,
 * out of the tab order, and read as unavailable rather than merely faint. It
 * comes back the moment the store says the ceremony is over, which is every
 * exit path at once.
 */
function LocalMethodSlot({
  isLastUsed,
  children,
}: {
  isLastUsed: boolean;
  children: ReactNode;
}) {
  const standBack = useOtherMethodsStandBack();

  return (
    <VStack
      width="full"
      align="stretch"
      gap={2}
      inert={standBack ? true : undefined}
      opacity={standBack ? 0.45 : undefined}
      transition="opacity 160ms ease"
      data-standing-back={standBack ? "true" : undefined}
    >
      {isLastUsed ? (
        <HStack width="full">
          <LastUsedBadge />
        </HStack>
      ) : null}
      {children}
    </VStack>
  );
}

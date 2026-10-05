import { normalizeSignInErrorCode } from "@langwatch/auth-contract";
import { Button, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity-contract";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { authApi as api } from "../../behavior/auth-api.ts";
import { safeRedirectTarget, signIn, useSession } from "../../behavior/auth-client.tsx";
import { replaceLocation } from "../../behavior/browser-navigation.ts";
import { useExpiredSessionRecovery } from "../../behavior/use-expired-session-recovery.ts";
import { usePasskeyAutofill } from "../../behavior/use-passkey-autofill.ts";
import { usePublicEnv } from "../../behavior/use-public-env.ts";
import { useSearchParams } from "../../behavior/use-route.ts";
import { useSignInRouting } from "../../behavior/use-sign-in-routing.ts";
import { signUpHref } from "../../model/carried-email.ts";
import type { FrontDoorDepth } from "../../model/ground-palette.ts";
import { usePublishFrontDoorStage } from "../../model/ground-stage.ts";
import {
  promotePendingMethod,
  readLastUsedMethodId,
  rememberPendingMethod,
} from "../../model/last-used-method.ts";
import { signInMethodActionLabel, signInMethodLabel } from "../../model/method-labels.ts";
import { shouldStartPasskeyOnArrival } from "../../model/method-ranking.ts";
import { readHandledError } from "../../model/read-handled-error.ts";
import { signInRoutingReasonCopy } from "../../model/routing-reason-copy.ts";
import { signInGreeting } from "../../model/sign-in-greeting.ts";
import { JOIN_BEFORE_CREATE_PATH } from "../../model/sign-up-destination.ts";
import {
  rememberSoleConnectionAutoDial,
  soleConnectionAutoDialAllowed,
} from "../../model/sole-connection-auto-dial.ts";
import { useTwoStepChallenge } from "../../model/two-step-challenge.ts";
import { AuthCard } from "../elements/auth-card.tsx";
import { CheckYourEmail } from "../elements/check-your-email.tsx";
import { HandledErrorAlert } from "../elements/handled-error-alert.tsx";
import { SecondaryActionLink } from "../elements/secondary-action-link.tsx";
import { CredentialSignInForm } from "./credential-sign-in-form.tsx";
import { FrontDoorFinePrint } from "./front-door-fine-print.tsx";
import { IdentifierStepForm } from "./identifier-step-form.tsx";
import { SignInError } from "./sign-in-error-screen.tsx";
import {
  AlternativeMethods,
  hasAlternativeMethods,
  SignInMethodPicker,
} from "./sign-in-method-picker.tsx";
import { TwoStepChallengePanel, twoStepChallengeTitle } from "./two-step-challenge-panel.tsx";

/** The picker's local slot: the password form for the address asked, and nothing for any other. */
function passwordMethodRenderer({
  email,
  callbackUrl,
  onUseDifferentEmail,
  onSignUpStarted,
}: {
  email: string;
  callbackUrl: string | undefined;
  onUseDifferentEmail: () => void;
  onSignUpStarted: (email: string) => void;
}) {
  return (method: SignInMethod) => {
    if (method.kind !== "password") return null;
    return (
      <CredentialSignInForm
        key={method.id}
        email={email}
        callbackUrl={callbackUrl}
        onUseDifferentEmail={onUseDifferentEmail}
        onSignUpStarted={onSignUpStarted}
      />
    );
  };
}

/**
 * The identifier-first log-in screen (D13, ADR-117 §6): ask for the address,
 * ask the server where it signs in, render the answer. An address nobody
 * holds becomes a sign-up with the address carried (revision 2026-08-25).
 */
export function IdentifierFirstSignIn() {
  const query = useSearchParams();
  const callbackUrl = query?.get("callbackUrl") ?? undefined;
  const breakGlass = query?.get("local") === "1";
  const error = normalizeSignInErrorCode(query?.get("error"));

  const { data: session } = useSession();
  const routing = useSignInRouting();
  const { decide } = routing;
  const askedOnMount = useRef(false);
  const [instanceMethods, setInstanceMethods] = useState<readonly SignInMethod[]>([]);
  const [lastUsedMethodId] = useState(() => readLastUsedMethodId());
  // Read once per mount, before this page dials anything itself.
  const [soleAutoDialAllowed] = useState(() => soleConnectionAutoDialAllowed());
  // The address is becoming an account; nothing is created or sent yet.
  const [signingUpEmail, setSigningUpEmail] = useState<string | null>(null);
  // The account's link is on its way, and nobody is signed in.
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Every failure this card can have shows in one place, at the top. A
  // passkey is refused from a button part-way down the rail of methods, and
  // an alert opening there pushes the rest of the rail down the page.
  const [passkeyError, setPasskeyError] = useState<unknown>(null);
  // One automatic passkey ceremony per screen, held here because the button
  // remounts; set when it starts and when it ends without a session.
  const [passkeyTried, setPasskeyTried] = useState(false);
  // A correct password that owes a second factor takes the whole card.
  const twoStep = useTwoStepChallenge();

  // The recommended way in, ahead of the button in the rail below: a passkey
  // offered from the address field's own autofill, where somebody who does not
  // remember making one will still find it.
  usePasskeyAutofill({
    enabled: instanceMethods.some((method) => method.kind === "passkey"),
    callbackUrl,
    onError: setPasskeyError,
  });

  useEffect(() => {
    if (!session) return;
    // A session is the only proof a federated hand-off worked, and this is
    // where the browser lands holding one.
    promotePendingMethod();
    replaceLocation(safeRedirectTarget(callbackUrl));
  }, [session, callbackUrl]);

  // Asked once, with no address: the answer is what tells this screen whether
  // an address is even the next question, and what the instance offers beside
  // it. A deployment that routes without one never shows the address step,
  // which is how a single-connection install keeps behaving as it does today.
  useEffect(() => {
    if (askedOnMount.current || session) return;
    askedOnMount.current = true;
    void decide({ identifier: null, breakGlass }).then((decision) => {
      if (decision?.outcome === "method_picker") {
        setInstanceMethods(decision.methodSet);
      }
    });
  }, [decide, breakGlass, session]);

  // After the instance question above, so the recovered address's answer is the one that stands.
  const recoveredEmail = useExpiredSessionRecovery({
    signedIn: Boolean(session),
    identifierInPlay: routing.identifier,
    decide,
    breakGlass,
  });

  const dialFederated = (method: SignInMethod) => {
    rememberPendingMethod(method);
    // The typed address rides along as the OIDC login hint, trimmed, so the
    // provider's own screen arrives prefilled.
    void signIn(method.id, { callbackUrl, loginHint: routing.identifier?.trim() || undefined });
  };

  const decision = routing.decision;
  // An address that is present but blank is the same as no address: the
  // password step it would render cannot sign anybody in — it posts an empty
  // username and the server answers "Invalid email", which reads as a
  // refusal of something the person never typed. Treated as absent, so they
  // land back on the address step and can simply type it.
  const submittedIdentifier = routing.identifier?.trim() ? routing.identifier : null;
  // A failed decision falls back to the address form rather than showing a
  // picker built from the decision before it: the methods on offer are the
  // answer to a question that just failed to be answered.
  const showPicker = !routing.error && decision && (breakGlass || submittedIdentifier !== null);
  // The address on its way to becoming an account, from either conversion:
  // the router said so, or a refused password found nobody holds it.
  const creatingAccountFor =
    signingUpEmail ??
    (decision?.outcome === "route_to_signup" && submittedIdentifier ? submittedIdentifier : null);

  // Told once, from the same state the returns below branch on, so the ground
  // can never be showing a step other than the one drawn over it.
  usePublishFrontDoorStage({
    door: "signin",
    depth: signInDepth({
      sentTo,
      creatingAccountFor,
      challenged: twoStep !== null,
      showPicker: Boolean(showPicker),
    }),
  });

  // Ahead of everything: a password has already been accepted.
  if (twoStep) {
    return (
      <AuthCard title={twoStepChallengeTitle({ factor: twoStep.factor })}>
        <TwoStepChallengePanel factor={twoStep.factor} callbackUrl={twoStep.callbackUrl} />
      </AuthCard>
    );
  }

  if (sentTo) {
    return (
      <CheckYourEmail
        email={sentTo}
        what="Open it to confirm the address and finish signing in."
        onUseDifferentEmail={() => {
          // All three, in this order: the address step reads the router's
          // identifier, so clearing only the sent-to state would land back on
          // the password step for the address they came here to change.
          setSentTo(null);
          setSigningUpEmail(null);
          routing.clear();
        }}
      />
    );
  }

  if (error) return <SignInError error={error} />;

  // Nothing is painted for somebody who is already logged in: the effect
  // above is already taking them where they were going, and a card that says
  // so would only flash on the way past.
  if (session) return null;

  if (decision?.outcome === "redirect_to_connection") {
    return (
      <RoutedToConnection
        decision={decision}
        onContinue={dialFederated}
        callbackUrl={callbackUrl}
        loginHint={submittedIdentifier?.trim() || undefined}
        {...routedHandOff({ decision, submittedIdentifier, soleAutoDialAllowed })}
      />
    );
  }

  // Nobody holds this address, so the journey is a sign-up and the screen says
  // so rather than drawing a password box that can only fail. The address is
  // carried, so nothing is retyped.
  if (creatingAccountFor) {
    return (
      <NoAccountYet
        email={creatingAccountFor}
        reasonCode={decision?.outcome === "route_to_signup" ? decision.reasonCode : null}
        callbackUrl={callbackUrl ?? JOIN_BEFORE_CREATE_PATH}
        onAwaitingConfirmation={(email) => {
          setSigningUpEmail(null);
          setSentTo(email);
        }}
        onAddressAlreadyRegistered={() => {
          // The projection had not caught up with the account: the way in is
          // the picker, which asking the router again renders.
          setSigningUpEmail(null);
          void decide({ identifier: creatingAccountFor, breakGlass });
        }}
        onUseDifferentEmail={() => {
          setSigningUpEmail(null);
          routing.clear();
        }}
      />
    );
  }

  if (showPicker) {
    return (
      <AuthCard {...signInGreeting(recoveredEmail)}>
        <HandledErrorAlert
          error={passkeyError}
          fallbackTitle="Could not use a passkey"
          className="lw-front-door-alert"
        />
        <SignInMethodPicker
          methodSet={decision.methodSet}
          reasonCode={decision.reasonCode}
          lastUsedMethodId={lastUsedMethodId}
          onFederatedMethodChosen={dialFederated}
          callbackUrl={callbackUrl}
          onPasskeyError={setPasskeyError}
          // The address submit IS the gesture the ceremony answers, so an
          // account holding a passkey gets the prompt, once.
          autoStartPasskey={shouldStartPasskeyOnArrival({
            reasonCode: decision.reasonCode,
            methodSet: decision.methodSet,
            alreadyTried: passkeyTried,
          })}
          onPasskeyAutoStarted={() => setPasskeyTried(true)}
          onPasskeyDeclined={() => setPasskeyTried(true)}
          renderLocalMethod={passwordMethodRenderer({
            email: submittedIdentifier ?? "",
            callbackUrl,
            onUseDifferentEmail: routing.clear,
            onSignUpStarted: setSigningUpEmail,
          })}
        />
        {/* The switch link is always here, carrying the address already
            typed: somebody who meant to sign up gets there in one click, and
            somebody who submits a password for an address with no account is
            already carried into sign-up by the form above. */}
        <SignUpLink
          callbackUrl={callbackUrl}
          email={submittedIdentifier}
          label="Or create an account instead"
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard {...signInGreeting(recoveredEmail)} finePrint={<FrontDoorFinePrint />}>
      {/* The alert explains the form; it does not replace it. A failure to
          reach the router is nearly always worth retrying, and the retry is
          typing the address again — so taking the field away leaves somebody
          holding an apology and no way to act on it. It sits above the form,
          and the form stays live underneath. */}
      <HandledErrorAlert
        error={routing.error}
        fallbackTitle="Could not start log-in"
        className="lw-front-door-alert"
      />
      <HandledErrorAlert
        error={passkeyError}
        fallbackTitle="Could not use a passkey"
        className="lw-front-door-alert"
      />
      <IdentifierStepForm
        submitLabel="Continue"
        isSubmitting={routing.isDeciding}
        onSubmit={({ email }) => decide({ identifier: email, breakGlass })}
        footer={<SignUpLink callbackUrl={callbackUrl} label="Or create an account instead" />}
        alternatives={
          hasAlternativeMethods({ methodSet: instanceMethods }) ? (
            <AlternativeMethods
              methodSet={instanceMethods}
              lastUsedMethodId={lastUsedMethodId}
              onFederatedMethodChosen={dialFederated}
              callbackUrl={callbackUrl}
              onPasskeyError={setPasskeyError}
            />
          ) : null
        }
      />
    </AuthCard>
  );
}

/**
 * Which of the log-in door's steps the screen below is drawing, for the ground
 * behind it. Read in the same order the returns are written in, so the two can
 * only ever agree.
 */
function signInDepth({
  sentTo,
  creatingAccountFor,
  challenged,
  showPicker,
}: {
  sentTo: string | null;
  creatingAccountFor: string | null;
  challenged: boolean;
  showPicker: boolean;
}): FrontDoorDepth {
  if (challenged) return "credential";
  if (sentTo) return "sent";
  if (creatingAccountFor || showPicker) return "credential";
  return "entry";
}

/** What the log-in door says about an unknown address where no confirmation
 *  link can be sent: what is missing, and who can fix it. */
const NO_ACCOUNT_WITHOUT_EMAIL_COPY = {
  title: "There is no account for that email address yet",
  describe:
    "This installation cannot send email, so it cannot confirm a new address. Ask an administrator to set up an email provider, or sign in with single sign-on once your organization has it.",
} as const;

/**
 * The address routed to no account (ADR-117, revision 2026-08-25). Offers the
 * sign-up and keeps a mistyped address one click away. Without an email
 * provider it sends no link and says what is missing instead.
 */
function NoAccountYet({
  email,
  reasonCode,
  callbackUrl,
  onAwaitingConfirmation,
  onAddressAlreadyRegistered,
  onUseDifferentEmail,
}: {
  email: string;
  /** Absent where a refused password found this address, not the router. */
  reasonCode: string | null;
  callbackUrl: string;
  onAwaitingConfirmation: (email: string) => void;
  onAddressAlreadyRegistered: () => void;
  onUseDifferentEmail: () => void;
}) {
  const guidance = reasonCode ? signInRoutingReasonCopy(reasonCode) : null;
  const requestVerification = api.auth.requestSignUpVerification.useMutation();
  const sendsEmail = usePublicEnv().data.HAS_EMAIL_PROVIDER_KEY;

  if (!sendsEmail) {
    return (
      <AuthCard
        title={NO_ACCOUNT_WITHOUT_EMAIL_COPY.title}
        intro={NO_ACCOUNT_WITHOUT_EMAIL_COPY.describe}
        finePrint={<FrontDoorFinePrint />}
      >
        <VStack width="full" align="stretch" gap="14px">
          <div data-testid="unknown-identifier" hidden>
            {email}
          </div>
          <Button variant="outline" onClick={onUseDifferentEmail}>
            Use a different email
          </Button>
        </VStack>
      </AuthCard>
    );
  }

  const beginSignUp = async () => {
    try {
      await requestVerification.mutateAsync({ email });
      onAwaitingConfirmation(email);
    } catch (failure) {
      if (readHandledError(failure)?.code === "email_already_registered") {
        onAddressAlreadyRegistered();
      }
    }
  };

  return (
    <AuthCard
      title={guidance?.title ?? "Let's create your account"}
      intro={
        guidance?.describe ??
        "There is no account for that email address yet, so this is a sign-up."
      }
      finePrint={<FrontDoorFinePrint />}
    >
      <VStack width="full" align="stretch" gap="14px">
        <div data-testid="unknown-identifier" hidden>
          {email}
        </div>
        <HandledErrorAlert
          error={requestVerification.error}
          fallbackTitle="Couldn't start your sign-up"
          className="lw-front-door-alert"
        />
        <Button
          colorPalette="orange"
          loading={requestVerification.isPending}
          onClick={() => void beginSignUp()}
        >
          Send confirmation link
        </Button>
        <Button variant="outline" onClick={onUseDifferentEmail}>
          Use a different email
        </Button>
        <SignUpLink
          callbackUrl={callbackUrl}
          email={email}
          label="Rather use the sign-up page? Go there instead"
        />
      </VStack>
    </AuthCard>
  );
}

/**
 * How long a hand-off is allowed to take before the screen admits to it. A
 * redirect inside this window paints nothing — an 80ms flash isn't information.
 */
const HANDOFF_QUIET_MS = 400;

/**
 * Whether a routed hand-off starts on its own. A typed address always dials; with no address
 * only the self-hosted sole connection does, and only if this tab was not just sent there,
 * so a failed round trip shows the button rather than looping.
 */
function routedHandOff({
  decision,
  submittedIdentifier,
  soleAutoDialAllowed,
}: {
  decision: RoutingDecision;
  submittedIdentifier: string | null;
  soleAutoDialAllowed: boolean;
}): { autoStart: boolean; onAutoStart?: () => void } {
  if (submittedIdentifier !== null) return { autoStart: true };
  if (decision.reasonCode !== "sole_active_connection") return { autoStart: false };

  return { autoStart: soleAutoDialAllowed, onAutoStart: () => rememberSoleConnectionAutoDial() };
}

/**
 * The decision routed this address to an identity provider; nothing is drawn
 * while the browser is on its way there. A slow or refused hand-off shows a
 * card saying where it's going, with a button for the refused case.
 */
export function RoutedToConnection({
  decision,
  onContinue,
  callbackUrl,
  loginHint,
  title = "Log in to LangWatch",
  footer,
  autoStart = true,
  onAutoStart,
}: {
  decision: RoutingDecision;
  onContinue: (method: SignInMethod) => void;
  callbackUrl?: string;
  /** Handed to the provider as the OIDC login hint, so its screen arrives prefilled. */
  loginHint?: string;
  /** Sign-up reaches this screen too, and it is not a log-in until the provider says so. */
  title?: string;
  /** The way out, which differs by the screen that routed here. */
  footer?: ReactNode;
  /** Whether the hand-off starts on its own or waits for the button. */
  autoStart?: boolean;
  /** Called once, when the hand-off starts on its own. */
  onAutoStart?: () => void;
}) {
  const method: SignInMethod | undefined = decision.methodSet[0];
  const dialed = useRef(false);
  const [waitIsVisible, setWaitIsVisible] = useState(false);

  useEffect(() => {
    if (!autoStart || !method || dialed.current) return;
    dialed.current = true;
    // Parked here too: the people routed by address are the dial nobody presses.
    rememberPendingMethod(method);
    onAutoStart?.();
    void signIn(method.id, { callbackUrl, loginHint });
  }, [autoStart, method, callbackUrl, loginHint, onAutoStart]);

  useEffect(() => {
    const timer = setTimeout(() => setWaitIsVisible(true), HANDOFF_QUIET_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!method) return null;
  if (autoStart && !waitIsVisible) return null;

  return (
    <AuthCard title={title}>
      <HStack gap={3}>
        {autoStart && <Spinner size="sm" color="orange.500" />}
        <Text data-testid="routed-to-connection">
          {autoStart
            ? `Taking you to your organization's sign-in with ${signInMethodLabel(method)}.`
            : `Log in with ${signInMethodLabel(method)} to continue.`}
        </Text>
      </HStack>
      <Button colorPalette="orange" onClick={() => onContinue(method)}>
        {signInMethodActionLabel(method)}
      </Button>
      {/* The way to the other screen, on this stage as on every other. */}
      {footer ?? <SignUpLink callbackUrl={callbackUrl} label="Or create an account instead" />}
    </AuthCard>
  );
}

function SignUpLink({
  callbackUrl,
  email,
  label,
}: {
  callbackUrl?: string;
  /** Carried so nobody types their address a second time. */
  email?: string | null;
  label: string;
}) {
  // No way to the sign-up screen where accounts are created by invitation: an
  // invited person arrives through the link in their invitation.
  const isInviteOnly = usePublicEnv().data.SIGN_UP_MODE === "invite_only";
  if (isInviteOnly) return null;

  // The address rides in the FRAGMENT, which is the half of a URL the browser
  // does not send: it reaches no access log and no `Referer` on the way to the
  // other door. See `signUpHref`.
  const href = signUpHref({ callbackUrl, email });

  return <SecondaryActionLink href={href} label={label} testId="go-to-sign-up" />;
}

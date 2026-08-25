import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { HandledErrorAlert } from "~/features/errors";
import { normalizeErrorCode, SignInError } from "~/pages/auth/error";
import { api } from "~/utils/api";
import { safeRedirectTarget, signIn, useSession } from "~/utils/auth-client";
import { replaceLocation } from "~/utils/browserNavigation";
import Link from "~/utils/compat/next-link";
import { useSearchParams } from "~/utils/compat/next-navigation";
import {
  useAuthAnalytics,
  usePublishAuthStep,
} from "../hooks/useAuthAnalytics";
import { usePasskeyAutofill } from "../hooks/usePasskeyAutofill";
import { useSignInRouting } from "../hooks/useSignInRouting";
import { AUTH_SURFACE, SIGN_IN_STEP } from "../logic/authAnalytics";
import { signUpHref } from "../logic/carriedEmail";
import type { AuthDepth } from "../logic/groundPalette";
import { usePublishAuthStage } from "../logic/groundStage";
import {
  promotePendingMethod,
  readLastUsedMethodId,
  rememberPendingMethod,
} from "../logic/lastUsedMethod";
import {
  signInMethodActionLabel,
  signInMethodLabel,
} from "../logic/methodLabels";
import { shouldStartPasskeyOnArrival } from "../logic/methodRanking";
import { usePasskeyCeremony } from "../logic/passkeyCeremony";
import { signInRoutingReasonCopy } from "../logic/routingReasonCopy";
import { useTwoStepChallenge } from "../logic/twoStepChallenge";
import { AuthFinePrint } from "./AuthFinePrint";
import { AuthPrimaryButton } from "./AuthPrimaryButton";
import { CheckYourEmail } from "./CheckYourEmail";
import { CredentialSignInForm } from "./CredentialSignInForm";
import { EmailPill } from "./EmailPill";
import { IdentifierStepForm } from "./IdentifierStepForm";
import {
  PasskeyCeremonyPanel,
  passkeyCeremonyTitle,
} from "./PasskeyCeremonyPanel";
import { SecondaryActionLink } from "./SecondaryActionLink";
import {
  AlternativeMethods,
  hasAlternativeMethods,
  SignInMethodPicker,
} from "./SignInMethodPicker";
import {
  TwoStepChallengePanel,
  twoStepChallengeTitle,
} from "./TwoStepChallengePanel";

/**
 * The identifier-first log-in screen (D13, ADR-117 §6).
 *
 * The order is the whole design: ask for the address, ask the server where it
 * signs in, render the answer. There is no branch in this file that decides
 * where anybody goes — a redirect happens because the decision said
 * `redirect_to_connection`, and a picker appears because it said
 * `method_picker`, with exactly the methods it named. On a domain that routes
 * to an identity provider a password field is never shown at all: the redirect
 * comes first, so there is nothing to type into wrongly.
 *
 * Nothing here dead-ends. An address nobody holds an account for never reaches
 * a password box at all now — the router says so and the screen becomes a
 * sign-up with the address already in it (ADR-117, revision 2026-08-25). A
 * password typed at a deployment whose router has not been told about accounts
 * still converts the same way it always did, through the form's own refusal.
 * A password that is wrong for an account that does exist still says so, in
 * the same words it always has.
 *
 * An account that holds a passkey gets the ceremony rather than a button
 * offering one: the address submit was the gesture, and this is its answer.
 * Declining it falls back to that account's next-best method with the retry
 * beside it, and never starts a second ceremony on its own.
 *
 * Two entrances skip the address step, and both are the decision's doing
 * rather than this screen's: a self-hosted deployment with one connection
 * routes with no address at all, and `?local=1` asks for the local method set
 * whatever else would have routed.
 */
export function IdentifierFirstSignIn() {
  const query = useSearchParams();
  const callbackUrl = query?.get("callbackUrl") ?? undefined;
  const breakGlass = query?.get("local") === "1";
  const error = normalizeErrorCode(query?.get("error"));

  const { data: session } = useSession();
  const routing = useSignInRouting();
  const report = useAuthAnalytics(AUTH_SURFACE.signIn);
  const { decide } = routing;
  const askedOnMount = useRef(false);
  const [instanceMethods, setInstanceMethods] = useState<
    readonly SignInMethod[]
  >([]);
  const [lastUsedMethodId] = useState(() => readLastUsedMethodId());
  const [signingUp, setSigningUp] = useState<string | null>(null);
  // Every failure this card can have shows in one place, at the top. A
  // passkey is refused from a button part-way down the rail of methods, and
  // an alert opening there pushes the rest of the rail down the page.
  const [passkeyError, setPasskeyError] = useState<unknown>(null);
  // Whether this screen has already run an automatic passkey ceremony. Held
  // HERE rather than in the button, because the button is unmounted while its
  // own ceremony holds the card and remounted when the panel comes down — a
  // guard inside it would be reset by exactly the event it has to survive, and
  // the screen would prompt again the moment somebody declined. Set when the
  // ceremony starts and again when it ends without a session, so neither a
  // decline nor a remount can produce a second one.
  const [passkeyTried, setPasskeyTried] = useState(false);
  // A ceremony somebody deliberately started. The conditional offer from the
  // address field never appears here — see `logic/passkeyCeremony.ts`.
  const passkeyCeremony = usePasskeyCeremony();
  // A correct password that owes a second factor, published by the password
  // form below and drawn here, because a challenge takes the whole card.
  const twoStep = useTwoStepChallenge();

  // The recommended way in, ahead of the button in the rail below: a passkey
  // offered from the address field's own autofill, where somebody who does not
  // remember making one will still find it.
  usePasskeyAutofill({
    enabled: instanceMethods.some((method) => method.kind === "passkey"),
    callbackUrl,
  });

  useEffect(() => {
    if (!session) return;
    // A session is the only proof a federated hand-off worked, and this is
    // where the browser lands holding one.
    report.signedIn(readLastUsedMethodId() ?? "unknown");
    promotePendingMethod();
    replaceLocation(safeRedirectTarget(callbackUrl));
  }, [session, callbackUrl, report]);

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

  const dialFederated = (method: SignInMethod) => {
    report.chose(method.id);
    rememberPendingMethod(method);
    void signIn(method.id, { callbackUrl });
  };

  const decision = routing.decision;
  // An address that is present but blank is the same as no address: the
  // password step it would render cannot sign anybody in — it posts an empty
  // username and the server answers "Invalid email", which reads as a
  // refusal of something the person never typed. Treated as absent, so they
  // land back on the address step and can simply type it.
  const submittedIdentifier = routing.identifier?.trim()
    ? routing.identifier
    : null;
  // A failed decision falls back to the address form rather than showing a
  // picker built from the decision before it: the methods on offer are the
  // answer to a question that just failed to be answered.
  const showPicker =
    !routing.error && decision && (breakGlass || submittedIdentifier !== null);

  // Told once, from the same state the returns below branch on, so the ground
  // can never be showing a step other than the one drawn over it.
  usePublishAuthStage({
    door: "signin",
    depth: signInDepth({
      signingUp,
      challenged: twoStep !== null,
      showPicker: Boolean(showPicker),
    }),
  });

  // The funnel's steps, read from the same state in the same order as the
  // returns below — the drop-off between them is the number this screen exists
  // to be judged by, and it is invisible to a page view.
  usePublishAuthStep({
    surface: AUTH_SURFACE.signIn,
    step: signInStep({
      challenged: twoStep !== null,
      signingUp: signingUp !== null,
      errored: Boolean(error),
      ceremony: passkeyCeremony !== null,
      outcome: decision?.outcome ?? null,
      hasIdentifier: submittedIdentifier !== null,
      showPicker: Boolean(showPicker),
    }),
    attributes: {
      // How this screen was entered, without saying by whom.
      breakGlass,
      reasonCode: decision?.reasonCode ?? null,
    },
  });

  // Ahead of everything: a password has already been accepted, so nothing the
  // address step or the picker could draw is the question any more.
  if (twoStep) {
    return (
      <AuthCard title={twoStepChallengeTitle(twoStep.factor)}>
        <TwoStepChallengePanel
          factor={twoStep.factor}
          callbackUrl={twoStep.callbackUrl}
        />
      </AuthCard>
    );
  }

  if (signingUp) {
    return (
      <CheckYourEmail
        email={signingUp}
        what="Open it to confirm the address, then choose a password."
        onUseDifferentEmail={() => {
          // Both, and in this order: the address step reads the router's
          // identifier, so clearing only the sent-to state would land back on
          // the password step for the address they came here to change.
          setSigningUp(null);
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

  // A ceremony in flight takes the card. Not a spinner on the button that
  // started it: the browser has the screen, the prompt may have opened on
  // another device, and a rail of live methods under a busy button invites a
  // second ceremony on top of the first.
  if (passkeyCeremony) {
    return (
      <AuthCard title={passkeyCeremonyTitle(passkeyCeremony)}>
        <PasskeyCeremonyPanel ceremony={passkeyCeremony} />
      </AuthCard>
    );
  }

  if (decision?.outcome === "redirect_to_connection") {
    return (
      <RoutedToConnection
        decision={decision}
        onContinue={dialFederated}
        callbackUrl={callbackUrl}
      />
    );
  }

  // Nobody holds this address, so the journey is a sign-up and the screen says
  // so rather than drawing a password box that can only fail (ADR-117,
  // revision 2026-08-25). The address is carried, so nothing is retyped.
  if (decision?.outcome === "route_to_signup" && submittedIdentifier) {
    return (
      <NoAccountYet
        email={submittedIdentifier}
        reasonCode={decision.reasonCode}
        callbackUrl={callbackUrl}
        onVerificationSent={setSigningUp}
        onUseDifferentEmail={routing.clear}
      />
    );
  }

  if (showPicker) {
    return (
      <AuthCard title="Log in to LangWatch">
        <HandledErrorAlert
          error={passkeyError}
          fallbackTitle="Could not use a passkey"
          className="lw-auth-alert"
        />
        <SignInMethodPicker
          methodSet={decision.methodSet}
          reasonCode={decision.reasonCode}
          lastUsedMethodId={lastUsedMethodId}
          onFederatedMethodChosen={dialFederated}
          callbackUrl={callbackUrl}
          onPasskeyError={setPasskeyError}
          // The identifier submit that produced this decision IS the gesture
          // the ceremony answers, so an account holding a passkey gets the
          // prompt rather than a button to press to get the prompt. Once, and
          // never again after it has been declined — see `methodRanking.ts`.
          autoStartPasskey={shouldStartPasskeyOnArrival({
            reasonCode: decision.reasonCode,
            methodSet: decision.methodSet,
            alreadyTried: passkeyTried,
          })}
          onPasskeyAutoStarted={() => setPasskeyTried(true)}
          onPasskeyDeclined={() => setPasskeyTried(true)}
          renderLocalMethod={(method) => {
            if (method.kind !== "password") return null;
            return (
              <CredentialSignInForm
                key={method.id}
                email={submittedIdentifier ?? ""}
                callbackUrl={callbackUrl}
                onUseDifferentEmail={routing.clear}
                onSignUpStarted={setSigningUp}
              />
            );
          }}
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
    <AuthCard title="Log in to LangWatch" finePrint={<AuthFinePrint />}>
      {/* The alert explains the form; it does not replace it. A failure to
          reach the router is nearly always worth retrying, and the retry is
          typing the address again — so taking the field away leaves somebody
          holding an apology and no way to act on it. It sits above the form,
          and the form stays live underneath. */}
      <HandledErrorAlert
        error={routing.error}
        fallbackTitle="Could not start log-in"
        className="lw-auth-alert"
      />
      <HandledErrorAlert
        error={passkeyError}
        fallbackTitle="Could not use a passkey"
        className="lw-auth-alert"
      />
      <IdentifierStepForm
        submitLabel="Continue"
        isSubmitting={routing.isDeciding}
        onSubmit={({ email }) => decide({ identifier: email, breakGlass })}
        footer={
          <SignUpLink
            callbackUrl={callbackUrl}
            label="Or create an account instead"
          />
        }
        alternatives={
          hasAlternativeMethods(instanceMethods) ? (
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
  signingUp,
  challenged,
  showPicker,
}: {
  signingUp: string | null;
  challenged: boolean;
  showPicker: boolean;
}): AuthDepth {
  if (challenged) return "challenge";
  if (signingUp) return "sent";
  if (showPicker) return "credential";
  return "entry";
}

/**
 * The address routed to no account (ADR-117, revision 2026-08-25).
 *
 * This used to be a password field. The router could not tell an unknown
 * address from a known one, so everybody got a credential box, and somebody
 * who had simply never signed up typed a password into it, was refused in
 * words that gave nothing away, and left. The refusal was honest and the
 * screen was still a dead end.
 *
 * Now the screen carries on. It says what happened, offers the thing they
 * almost certainly came for, and keeps the other real possibility — a mistyped
 * address — one click away rather than behind the browser's back button.
 *
 * No password is asked for here and none is kept. The account is created the
 * way the sign-up door creates one: a confirmation link, then a password
 * chosen once on the screen built to ask for it.
 */
function NoAccountYet({
  email,
  reasonCode,
  callbackUrl,
  onVerificationSent,
  onUseDifferentEmail,
}: {
  email: string;
  reasonCode: string;
  callbackUrl?: string;
  onVerificationSent: (email: string) => void;
  onUseDifferentEmail: () => void;
}) {
  const requestVerification = api.auth.requestSignUpVerification.useMutation();
  const guidance = signInRoutingReasonCopy(reasonCode);

  const send = () => {
    requestVerification.mutate(
      { email },
      { onSuccess: () => onVerificationSent(email) },
    );
  };

  return (
    <AuthCard
      title={guidance?.title ?? "There is no account for that email yet"}
      intro={guidance?.describe}
    >
      <VStack width="full" align="stretch" gap="14px">
        {/* Never `error.message`: for a handled refusal that message IS the
            code slug (#5984). The registry owns the words. */}
        <HandledErrorAlert
          error={requestVerification.error}
          fallbackTitle="Couldn't start creating your account"
          className="lw-auth-alert"
        />
        <EmailPill
          email={email}
          actionLabel="Use a different email"
          onAction={onUseDifferentEmail}
          testId="unknown-identifier"
        />
        <AuthPrimaryButton
          isBusy={requestVerification.isPending}
          onClick={send}
          testId="create-account-here"
        >
          Create an account
        </AuthPrimaryButton>
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
 * How long a hand-off is allowed to take before the screen admits to it.
 *
 * A redirect that lands inside this window paints nothing at all, which is the
 * whole point: a message that flashes for 80 milliseconds is not information,
 * it is a flicker. Past it the wait is real, and a blank page would be the
 * worse answer.
 */
const HANDOFF_QUIET_MS = 400;

/**
 * The decision routed this address to an identity provider, so the browser is
 * on its way there.
 *
 * Nothing is drawn while that is happening. If the hand-off turns out to be
 * slow, or the browser refused to follow it, the card appears and says where
 * they are going, with a button for the second case.
 */
export function RoutedToConnection({
  decision,
  onContinue,
  callbackUrl,
  title = "Log in to LangWatch",
  footer,
}: {
  decision: RoutingDecision;
  onContinue: (method: SignInMethod) => void;
  callbackUrl?: string;
  /** The card's heading. Sign-up reaches this screen too, and it is not a
   *  log-in until the provider says so. */
  title?: string;
  /** The way out, which differs by the screen that routed here. */
  footer?: ReactNode;
}) {
  const method: SignInMethod | undefined = decision.methodSet[0];
  const dialed = useRef(false);
  const [waitIsVisible, setWaitIsVisible] = useState(false);

  useEffect(() => {
    if (!method || dialed.current) return;
    dialed.current = true;
    void signIn(method.id, { callbackUrl });
  }, [method, callbackUrl]);

  useEffect(() => {
    const timer = setTimeout(() => setWaitIsVisible(true), HANDOFF_QUIET_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!method) return null;
  if (!waitIsVisible) return null;

  return (
    <AuthCard title={title}>
      <HStack gap={3}>
        <Spinner size="sm" color="orange.500" />
        <Text data-testid="routed-to-connection">
          Taking you to your organization's sign-in with{" "}
          {signInMethodLabel(method)}.
        </Text>
      </HStack>
      <AuthPrimaryButton onClick={() => onContinue(method)}>
        {signInMethodActionLabel(method)}
      </AuthPrimaryButton>
      {/* The way to the other screen, on this stage as on every other. A
          hand-off that is taking too long is exactly where somebody realises
          they do not have an account here yet, and the browser's back button
          lands on a step this screen keeps in memory rather than in the URL. */}
      {footer ?? (
        <SignUpLink
          callbackUrl={callbackUrl}
          label="Or create an account instead"
        />
      )}
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
  // The address rides in the FRAGMENT, which is the half of a URL the browser
  // does not send: it reaches no access log and no `Referer` on the way to the
  // other screen. See `signUpHref`.
  const href = signUpHref({ callbackUrl, email });

  return (
    <SecondaryActionLink href={href} label={label} testId="go-to-sign-up" />
  );
}

/**
 * Which step of the log-in screen the funnel is being told about.
 *
 * A separate reading from `signInDepth`, which answers how far in the GROUND
 * should look and deliberately collapses steps that sit at the same distance.
 * The funnel needs them apart: a hand-off to an identity provider and a
 * password rail are the same depth and completely different outcomes.
 *
 * Read in the order the returns are written in, so the screen and the funnel
 * cannot disagree about which step somebody is on.
 */
function signInStep({
  challenged,
  signingUp,
  errored,
  ceremony,
  outcome,
  hasIdentifier,
  showPicker,
}: {
  challenged: boolean;
  signingUp: boolean;
  errored: boolean;
  ceremony: boolean;
  outcome: string | null;
  hasIdentifier: boolean;
  showPicker: boolean;
}): string {
  if (challenged) return SIGN_IN_STEP.challenge;
  if (signingUp) return SIGN_IN_STEP.checkEmail;
  if (errored) return SIGN_IN_STEP.error;
  if (ceremony) return SIGN_IN_STEP.passkeyCeremony;
  if (outcome === "redirect_to_connection") {
    return SIGN_IN_STEP.routedToConnection;
  }
  if (outcome === "route_to_signup" && hasIdentifier) {
    return SIGN_IN_STEP.signUpHandoff;
  }
  if (showPicker) return SIGN_IN_STEP.methodPicker;
  return SIGN_IN_STEP.address;
}

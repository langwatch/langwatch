import { isSafeReturnToPath, type SignUpEnrollment } from "@langwatch/auth-contract";
import { HStack, Text } from "@langwatch/design-system/primitives";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import { authApi as api } from "../../behavior/auth-api.ts";
import { signIn, useSession } from "../../behavior/auth-client.tsx";
import { dropQueryParameter } from "../../behavior/browser-navigation.ts";
import { confirmSignUpAddress } from "../../behavior/confirm-sign-up-address.ts";
import { hardRedirect } from "../../behavior/hard-redirect.ts";
import {
  forgetHeldAddressProof,
  type HeldAddressProof,
  holdAddressProof,
  takeHeldAddressProofOnReload,
} from "../../behavior/held-address-proof.ts";
import { usePasskeyCeremony } from "../../behavior/passkey-ceremony.store.ts";
import { useSearchParams } from "../../behavior/use-route.ts";
import { useSignInRouting } from "../../behavior/use-sign-in-routing.ts";
import { forgetCarriedEmail, readCarriedEmail } from "../../model/carried-email.ts";
import type { FrontDoorDepth } from "../../model/ground-palette.ts";
import { usePublishFrontDoorStage } from "../../model/ground-stage.ts";
import { JOIN_BEFORE_CREATE_PATH } from "../../model/join-before-create.ts";
import { readLastUsedMethodId, rememberPendingMethod } from "../../model/last-used-method.ts";
import { readHandledError } from "../../model/read-handled-error.ts";
import { useTwoStepChallenge } from "../../model/two-step-challenge.ts";
import { AuthCard } from "../elements/auth-card.tsx";
import { CheckYourEmail } from "../elements/check-your-email.tsx";
import { FrontDoorPrimaryButton } from "../elements/front-door-primary-button.tsx";
import { HandledErrorAlert } from "../elements/handled-error-alert.tsx";
import { SecondaryActionLink } from "../elements/secondary-action-link.tsx";
import { SuccessPulse } from "../elements/success-pulse.tsx";
import { CredentialSignInForm } from "./credential-sign-in-form.tsx";
import { FrontDoorFinePrint } from "./front-door-fine-print.tsx";
import { RoutedToConnection } from "./identifier-first-sign-in.tsx";
import { IdentifierStepForm } from "./identifier-step-form.tsx";
import { PasskeyCeremonyPanel, passkeyCeremonyTitle } from "./passkey-ceremony-panel.tsx";
import {
  AlternativeMethods,
  hasAlternativeMethods,
  SignInMethodPicker,
} from "./sign-in-method-picker.tsx";
import { SignUpCredentialForm } from "./sign-up-credential-form.tsx";
import { TwoStepChallengePanel, twoStepChallengeTitle } from "./two-step-challenge-panel.tsx";

type Decide = ReturnType<typeof useSignInRouting>["decide"];
type ResolveEnrollment = ReturnType<typeof useProofEnrollment>["resolveEnrollment"];
type RequestSignUpVerification = ReturnType<
  typeof api.auth.requestSignUpVerification.useMutation
>["mutateAsync"];

/** Spends the emailed link once, on arrival, and turns its answer into the card's next step. */
async function spendSignUpLink({
  token,
  callbackUrl,
  decide,
  resolveEnrollment,
  onAnswered,
  onSignedIn,
  onAccountReady,
  onProofSpent,
}: {
  token: string;
  callbackUrl: string | undefined;
  decide: Decide;
  resolveEnrollment: ResolveEnrollment;
  /** The server answered, so the token is spent or refused: nothing is left to ask again. */
  onAnswered: () => void;
  onSignedIn: (email: string) => void;
  onAccountReady: (email: string) => void;
  onProofSpent: (email: string) => void;
}): Promise<void> {
  const answer = await confirmSignUpAddress({ token }).catch((failure: unknown) => {
    // A request that never reached the server spent nothing: a reload may ask again.
    if (!(failure instanceof TypeError)) onAnswered();
    throw failure;
  });
  onAnswered();
  const { email, accountCreated, accountExists, addressProof, signedIn } = answer;
  // The link opened the session: a full navigation, so everything cached as signed out goes.
  if (signedIn) {
    onSignedIn(email);
    hardRedirect(callbackUrl ?? JOIN_BEFORE_CREATE_PATH);
    return;
  }
  // A reopened link opens no second session, so the way in is offered.
  if (accountCreated || accountExists) {
    onAccountReady(email);
    await decide({ identifier: email });
    return;
  }
  if (!addressProof) {
    onProofSpent(email);
    return;
  }
  await resolveEnrollment(email, addressProof);
}

/** Asks for a confirmation link to the address; `null` when none went out. */
async function requestSignUpLink({
  email,
  callbackUrl,
  request,
  decide,
  resolveEnrollment,
  onUnconfirmed,
  onSent,
  onAlreadyRegistered,
}: {
  email: string;
  /** Rides on the emailed link, so a sign-up finished in a fresh tab lands where this one went. */
  callbackUrl: string | undefined;
  request: RequestSignUpVerification;
  decide: Decide;
  resolveEnrollment: ResolveEnrollment;
  onUnconfirmed: () => void;
  onSent: (email: string) => void;
  onAlreadyRegistered: (email: string) => void;
}): Promise<"link_sent" | "unconfirmed" | null> {
  try {
    const result = await request({ email, ...(callbackUrl ? { callbackUrl } : {}) });
    if (!result.sent) {
      // No link can be mailed here, so the password step comes straight away.
      onUnconfirmed();
      await resolveEnrollment(email, result.addressProof);
      return "unconfirmed";
    }
    onSent(email);
    return "link_sent";
  } catch (failure) {
    // Not a refusal, a wrong door: the address has an account, so the screen
    // turns into the way into it rather than telling somebody to start again
    // somewhere else.
    if (readHandledError(failure)?.code === "email_already_registered") {
      onAlreadyRegistered(email);
      await decide({ identifier: email });
    }
    // Anything else renders from the mutation's error, through the registry.
    return null;
  }
}

/** Asks the router first; only an address no connection claims is sent a link. */
async function routeThenSend({
  email,
  decide,
  onRouted,
  sendTo,
}: {
  email: string;
  decide: Decide;
  onRouted: (email: string) => void;
  sendTo: (email: string) => Promise<unknown>;
}): Promise<void> {
  const decision = await decide({ identifier: email });
  if (decision?.outcome === "redirect_to_connection") {
    onRouted(email);
    return;
  }
  if (!decision) return;
  await sendTo(email);
}

/** A fresh link for a spent one; the dead-link card stays until one went out. */
async function resendLink({
  email,
  sendTo,
  onSent,
}: {
  email: string;
  sendTo: (email: string) => Promise<"link_sent" | "unconfirmed" | null>;
  onSent: () => void;
}): Promise<void> {
  if ((await sendTo(email)) !== null) onSent();
}

/**
 * The card's hand-off into the app, once the person is in: the link signed them in, or
 * a dead link opened in a browser already signed in (the link worked, then the page
 * loaded again), which is not a failure to show.
 */
function useSignedInHandOff({
  signedInAs,
  verifyToken,
  linkError,
  readyAccount,
  callbackUrl,
}: {
  signedInAs: string | null;
  verifyToken: string | null | undefined;
  linkError: unknown;
  /** The address a reopened link confirmed, and whether an account already stands behind it. */
  readyAccount: { email: string | null; isReady: boolean };
  callbackUrl: string | undefined;
}): { email: string | null; message: string } | null {
  const { data: session } = useSession();
  const deadLinkSignedIn = Boolean(verifyToken && linkError && session);
  const readyAccountSignedIn =
    readyAccount.isReady &&
    readyAccount.email !== null &&
    session?.user.email === readyAccount.email;
  const signedIn = deadLinkSignedIn || readyAccountSignedIn;
  useEffect(() => {
    if (signedIn) hardRedirect(callbackUrl ?? JOIN_BEFORE_CREATE_PATH);
  }, [signedIn, callbackUrl]);
  if (signedInAs) {
    return { email: signedInAs, message: `${signedInAs} is confirmed. Taking you to LangWatch.` };
  }
  if (!signedIn) return null;
  const email = session?.user.email || null;
  return {
    email,
    message: email
      ? `You're signed in as ${email}. Taking you to LangWatch.`
      : "You're signed in. Taking you to LangWatch.",
  };
}

/**
 * Sign-up (D13, ADR-117 §6): address, link, proof, then password. The account
 * is created only by spending the proof the link returned. An address with an
 * account already becomes the log-in step, pre-filled, not a wall.
 */
export function VerificationFirstSignUp() {
  const query = useSearchParams();
  // Arrived on the query string, so held to a path on this site before it is followed or mailed.
  const requestedCallbackUrl = query?.get("callbackUrl");
  const callbackUrl = isSafeReturnToPath(requestedCallbackUrl) ? requestedCallbackUrl : undefined;
  const verifyToken = query?.get("verify");
  // Carried in the FRAGMENT, so the address the log-in door hands over never
  // travelled on a request line. Read at first paint because the field it
  // prefills is drawn then, and forgotten immediately after — see
  // `carriedEmail`.
  const [carriedEmail] = useState(readCarriedEmail);
  useEffect(forgetCarriedEmail, []);

  const requestVerification = api.auth.requestSignUpVerification.useMutation();
  // Spent against the Better Auth endpoint, which can set a cookie; its refusal is held here.
  const [linkError, setLinkError] = useState<unknown>(null);
  // The address the link signed in, once it has: the card becomes the hand-off into the app.
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const routing = useSignInRouting();
  const { decide } = routing;

  const [sentTo, setSentTo] = useState<string | null>(null);
  // The address's domain routes through an identity provider, which makes the account.
  const [routedEmail, setRoutedEmail] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  // The single-use proof `auth.register` spends; only where no account stands behind the address.
  const [addressProof, setAddressProof] = useState<string | null>(null);
  // False where the installation cannot send email: the proof confirms nobody's address.
  const [addressConfirmed, setAddressConfirmed] = useState(true);
  // A link opened again after its proof was spent elsewhere: a fresh link is the way on.
  const [proofRecoveryEmail, setProofRecoveryEmail] = useState<string | null>(null);
  const [accountIsReady, setAccountIsReady] = useState(false);
  const [welcomeBackEmail, setWelcomeBackEmail] = useState<string | null>(null);
  const [lastUsedMethodId] = useState(() => readLastUsedMethodId());
  // Every failure this card can have shows in one place, at the top. A
  // passkey is refused from a button part-way down the rail of methods, and
  // an alert opening there pushes the rest of the rail down the page.
  const [passkeyError, setPasskeyError] = useState<unknown>(null);
  const spent = useRef(false);
  const proofEnrollment = useProofEnrollment({
    decide,
    routingError: routing.error,
    onWelcomeBack: setWelcomeBackEmail,
    onRouted: setRoutedEmail,
    onEnrolled: (email, proof) => {
      setVerifiedEmail(email);
      setAddressProof(proof);
      holdAddressProof({ email, addressProof: proof });
    },
  });
  const { enrollment, failedLink, resolveEnrollment } = proofEnrollment;
  const isRestoring = useHeldProofRestore({
    verifyToken,
    restoreEnrollment: proofEnrollment.restoreEnrollment,
  });

  // The emailed link is spent once, on arrival: the spend is shared per token across
  // remounts, and the token leaves the address bar so a reload cannot spend it again.
  useEffect(() => {
    if (!verifyToken || spent.current) return;
    spent.current = true;
    void spendSignUpLink({
      token: verifyToken,
      callbackUrl,
      decide,
      resolveEnrollment,
      onAnswered: () => dropQueryParameter("verify"),
      onSignedIn: setSignedInAs,
      onAccountReady: (email) => {
        setVerifiedEmail(email);
        setAccountIsReady(true);
      },
      onProofSpent: setProofRecoveryEmail,
    }).catch(setLinkError);
  }, [verifyToken, callbackUrl, decide, resolveEnrollment]);

  const handOff = useSignedInHandOff({
    signedInAs,
    verifyToken,
    linkError,
    readyAccount: { email: verifiedEmail, isReady: accountIsReady },
    callbackUrl,
  });

  const instanceMethods = useInstanceMethods({ decide, verifyToken });

  const dialFederated = (method: SignInMethod) => {
    rememberPendingMethod(method);
    return signIn(method.id, {
      callbackUrl: callbackUrl ?? JOIN_BEFORE_CREATE_PATH,
      // The routed address prefills the provider's screen as the OIDC login hint.
      loginHint: routedEmail?.trim() || undefined,
    });
  };

  const sendTo = (email: string) =>
    requestSignUpLink({
      email,
      callbackUrl,
      request: requestVerification.mutateAsync,
      decide,
      resolveEnrollment,
      onUnconfirmed: () => setAddressConfirmed(false),
      onSent: setSentTo,
      onAlreadyRegistered: setWelcomeBackEmail,
    });

  // Told once, from the same state the returns below branch on, so the ground
  // can never be showing a step other than the one drawn over it.
  const twoStep = useTwoStepChallenge();
  // A passkey ceremony somebody deliberately started, from whichever passkey button they pressed.
  const passkeyCeremony = usePasskeyCeremony();
  usePublishFrontDoorStage({
    door: "signup",
    depth: signUpDepth({
      handOff,
      verifiedEmail,
      accountIsReady,
      addressProof,
      welcomeBackEmail,
      sentTo,
      routedEmail,
    }),
  });

  // Ahead of everything: a password typed on the welcome-back step was accepted.
  if (twoStep) {
    return (
      <AuthCard title={twoStepChallengeTitle({ factor: twoStep.factor })}>
        <TwoStepChallengePanel factor={twoStep.factor} callbackUrl={twoStep.callbackUrl} />
      </AuthCard>
    );
  }

  if (passkeyCeremony) {
    return (
      <AuthCard title={passkeyCeremonyTitle({ ceremony: passkeyCeremony })}>
        <PasskeyCeremonyPanel ceremony={passkeyCeremony} />
      </AuthCard>
    );
  }

  if (welcomeBackEmail) {
    return (
      <WelcomeBack
        email={welcomeBackEmail}
        decision={routing.decision}
        lastUsedMethodId={lastUsedMethodId}
        callbackUrl={callbackUrl}
        onFederatedMethodChosen={dialFederated}
        onUseDifferentEmail={() => {
          setWelcomeBackEmail(null);
          // The refusal that sent this address here was THAT address's.
          requestVerification.reset();
        }}
      />
    );
  }

  // The navigation is already under way; this is the card it leaves behind meanwhile.
  if (handOff) {
    return (
      <AuthCard title="You're in">
        <HStack gap={3}>
          <SuccessPulse label="Signed in" />
          <Text data-testid="signed-in-handoff">{handOff.message}</Text>
        </HStack>
      </AuthCard>
    );
  }

  if (proofRecoveryEmail) {
    return (
      <LinkNoLongerWorks
        error={{ error: "identity_verification_used" }}
        isSending={requestVerification.isPending}
        callbackUrl={callbackUrl}
        onResend={(email) =>
          resendLink({ email, sendTo, onSent: () => setProofRecoveryEmail(null) })
        }
      />
    );
  }

  if (failedLink) {
    return (
      <PostLinkRoutingFailure
        addressConfirmed={addressConfirmed}
        error={proofEnrollment.failure}
        onRetry={() => resolveEnrollment(failedLink.email, failedLink.addressProof)}
      />
    );
  }

  if (verifiedEmail && accountIsReady) {
    return (
      <AccountIsReady
        email={verifiedEmail}
        decision={routing.decision}
        lastUsedMethodId={lastUsedMethodId}
        callbackUrl={callbackUrl ?? JOIN_BEFORE_CREATE_PATH}
        onFederatedMethodChosen={dialFederated}
      />
    );
  }

  if (verifiedEmail && addressProof && enrollment) {
    return (
      <MethodChoice
        verifiedEmail={verifiedEmail}
        addressProof={addressProof}
        addressConfirmed={addressConfirmed}
        enrollment={enrollment}
        lastUsedMethodId={lastUsedMethodId}
        callbackUrl={callbackUrl ?? JOIN_BEFORE_CREATE_PATH}
        onFederatedMethodChosen={dialFederated}
      />
    );
  }

  // Before the dead-link branch, deliberately: the dead link's error never
  // clears, so a successful resend FROM that screen must win this race or
  // the person clicks "Send a new link" forever and the screen never moves.
  if (sentTo) {
    return (
      <CheckYourEmail
        email={sentTo}
        what="Open it to confirm the address and finish signing in."
        onUseDifferentEmail={() => setSentTo(null)}
      />
    );
  }

  if (verifyToken && linkError) {
    return (
      <LinkNoLongerWorks
        error={linkError}
        isSending={requestVerification.isPending}
        callbackUrl={callbackUrl}
        onResend={sendTo}
      />
    );
  }

  // Ahead of the credential step: the organization routes this domain through an identity
  // provider, so the account is made there and a password box here would be the thing the
  // connection forbids.
  if (routedEmail && routing.decision?.outcome === "redirect_to_connection") {
    return (
      <RoutedToConnection
        decision={routing.decision}
        onContinue={dialFederated}
        callbackUrl={callbackUrl ?? JOIN_BEFORE_CREATE_PATH}
        loginHint={routedEmail.trim() || undefined}
        title="Create your LangWatch account"
        footer={<LogInLink callbackUrl={callbackUrl} label="Or log in instead" />}
      />
    );
  }

  // The tab holds a confirmed address: its step comes back rather than the address step flashing.
  if (isRestoring) return <AuthCard title="Create your account" />;

  return (
    <AuthCard title="Create your LangWatch account" finePrint={<FrontDoorFinePrint />}>
      {requestVerification.error ? (
        <HandledErrorAlert
          error={requestVerification.error}
          fallbackTitle="Couldn't start your sign-up"
        />
      ) : null}
      {/* The router decides whether this address may hold a password at all: its failure
          is why the journey stopped, so it stays on screen with a way to try again. */}
      <HandledErrorAlert error={routing.error} fallbackTitle="Couldn't check how you sign in" />
      <HandledErrorAlert error={passkeyError} fallbackTitle="Could not use a passkey" />
      <IdentifierStepForm
        submitLabel="Continue"
        isSubmitting={requestVerification.isPending || routing.isDeciding}
        defaultEmail={carriedEmail}
        // The ROUTER decides what this address is offered, the same question log-in asks.
        // No answer is not "no connection": a routing failure stops here, rendered above.
        onSubmit={({ email }) => routeThenSend({ email, decide, onRouted: setRoutedEmail, sendTo })}
        footer={<LogInLink callbackUrl={callbackUrl} label="Or log in instead" />}
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
 * The address already has an account, so this is a log-in that started on the
 * wrong page. Same picker, same methods, address carried: nothing about the
 * situation asks the person to do the work twice.
 */
function WelcomeBack({
  email,
  decision,
  lastUsedMethodId,
  callbackUrl,
  onFederatedMethodChosen,
  onUseDifferentEmail,
}: {
  email: string;
  decision: RoutingDecision | null;
  lastUsedMethodId: string | null;
  callbackUrl: string | undefined;
  onFederatedMethodChosen: (method: SignInMethod) => void;
  onUseDifferentEmail: () => void;
}) {
  const [passkeyError, setPasskeyError] = useState<unknown>(null);

  return (
    // No notice, no callout, nothing that reads as a refusal: somebody who
    // clicked the wrong page gets the right page, and the only thing that
    // changes is the words on it.
    <AuthCard title="Welcome back">
      <div data-testid="welcome-back" hidden />
      <HandledErrorAlert error={passkeyError} fallbackTitle="Could not use a passkey" />
      {decision ? (
        <SignInMethodPicker
          methodSet={decision.methodSet}
          reasonCode={decision.reasonCode}
          lastUsedMethodId={lastUsedMethodId}
          onFederatedMethodChosen={onFederatedMethodChosen}
          callbackUrl={callbackUrl}
          onPasskeyError={setPasskeyError}
          renderLocalMethod={(method) =>
            method.kind === "password" ? (
              <CredentialSignInForm
                key={method.id}
                email={email}
                callbackUrl={callbackUrl}
                onUseDifferentEmail={onUseDifferentEmail}
              />
            ) : null
          }
        />
      ) : null}
    </AuthCard>
  );
}

/**
 * The account exists and the link is the address catching up, so what is left is the way
 * in: the ROUTED methods rather than a password box, because the account's credential may
 * be a passkey. Same picker as log-in, so the two can never offer different things.
 */
function AccountIsReady({
  email,
  decision,
  lastUsedMethodId,
  callbackUrl,
  onFederatedMethodChosen,
}: {
  email: string;
  decision: RoutingDecision | null;
  lastUsedMethodId: string | null;
  callbackUrl: string;
  onFederatedMethodChosen: (method: SignInMethod) => void;
}) {
  const [passkeyError, setPasskeyError] = useState<unknown>(null);

  return (
    <AuthCard title="Your account is ready">
      <HStack gap={3}>
        <SuccessPulse label="Account created" />
        <Text data-testid="account-ready">{email} is confirmed.</Text>
      </HStack>
      <HandledErrorAlert error={passkeyError} fallbackTitle="Could not use a passkey" />
      {decision ? (
        <SignInMethodPicker
          methodSet={decision.methodSet}
          reasonCode={decision.reasonCode}
          lastUsedMethodId={lastUsedMethodId}
          onFederatedMethodChosen={onFederatedMethodChosen}
          callbackUrl={callbackUrl}
          onPasskeyError={setPasskeyError}
          renderLocalMethod={(method) =>
            method.kind === "password" ? (
              <CredentialSignInForm
                key={method.id}
                email={email}
                callbackUrl={callbackUrl}
                onUseDifferentEmail={() => hardRedirect("/auth/signin")}
              />
            ) : null
          }
        />
      ) : null}
    </AuthCard>
  );
}

/**
 * An expired, spent or unknown link. It offers one thing, a fresh link, and
 * confirms nothing on the way: no address is held and no method is offered
 * until a link that works comes back.
 */
function LinkNoLongerWorks({
  error,
  isSending,
  callbackUrl,
  onResend,
}: {
  error: unknown;
  isSending: boolean;
  callbackUrl?: string;
  onResend: (email: string) => undefined | Promise<unknown>;
}) {
  return (
    <AuthCard
      title="Create your LangWatch account"
      intro="Enter your email and we will send a new confirmation link."
    >
      <HandledErrorAlert error={error} fallbackTitle="That confirmation link no longer works" />
      <IdentifierStepForm
        submitLabel="Send a new link"
        isSubmitting={isSending}
        onSubmit={({ email }) => onResend(email)}
        footer={<LogInLink callbackUrl={callbackUrl} label="Or log in instead" />}
      />
    </AuthCard>
  );
}

/**
 * Which of the sign-up door's steps the screen below is drawing, for the
 * ground behind it. Read in the same order the returns are written in, so the
 * two can only ever agree.
 */
function signUpDepth({
  handOff,
  verifiedEmail: provenEmail,
  accountIsReady: provenAccountIsReady,
  addressProof,
  welcomeBackEmail,
  sentTo,
  routedEmail,
}: {
  /** The hand-off into the app counts as a ready account for its address. */
  handOff: { email: string | null } | null;
  verifiedEmail: string | null;
  accountIsReady: boolean;
  addressProof: string | null;
  welcomeBackEmail: string | null;
  sentTo: string | null;
  routedEmail: string | null;
}): FrontDoorDepth {
  const verifiedEmail = handOff?.email ?? provenEmail;
  const accountIsReady = provenAccountIsReady || handOff !== null;
  if (verifiedEmail && accountIsReady) return "settled";
  if (welcomeBackEmail !== null) return "credential";
  if (verifiedEmail !== null && addressProof !== null) return "credential";
  // The hand-off is as far in as the credential step it replaces.
  if (routedEmail !== null) return "credential";
  if (sentTo !== null) return "sent";
  return "entry";
}

/** Nothing can refuse a passkey on a step that offers none. Named rather than
 *  written inline so the reason travels with it. */
const noPasskeyOnThisStep = () => undefined;

/**
 * The address is confirmed, so the question is which sign-in method to hold.
 * The picker is the log-in screen's, unchanged: one component, so the two
 * screens cannot come to offer different things.
 */
function MethodChoice({
  verifiedEmail,
  addressProof,
  addressConfirmed,
  enrollment,
  lastUsedMethodId,
  callbackUrl,
  onFederatedMethodChosen,
}: {
  verifiedEmail: string;
  addressProof: string;
  /** False when the proof stands for an address no link confirmed. */
  addressConfirmed: boolean;
  enrollment: SignUpEnrollment;
  lastUsedMethodId: string | null;
  callbackUrl: string;
  onFederatedMethodChosen: (method: SignInMethod) => void;
}) {
  return (
    <AuthCard title="Create your account">
      {addressConfirmed ? null : (
        <Text data-testid="unconfirmed-address">
          This installation does not send email, so {verifiedEmail} is not confirmed. Choose a
          password to finish.
        </Text>
      )}
      {enrollment ? (
        <SignInMethodPicker
          // Every way in EXCEPT a passkey. This step belongs to an account
          // being made: there is no credential on this device to find yet, so
          // the ceremony would open a prompt with nothing in it. A passkey
          // becomes an offer once there is one to enrol (D07).
          methodSet={enrollment.methodSet.filter((method) => method.kind !== "passkey")}
          reasonCode={enrollment.reasonCode}
          showGuidance={false}
          lastUsedMethodId={lastUsedMethodId}
          onFederatedMethodChosen={onFederatedMethodChosen}
          callbackUrl={callbackUrl}
          // Nothing can arrive: the set above has had every passkey taken out
          // of it, so there is no seat here to refuse one.
          onPasskeyError={noPasskeyOnThisStep}
          renderLocalMethod={(method) =>
            method.kind === "password" ? (
              <SignUpCredentialForm
                key={method.id}
                email={verifiedEmail}
                addressProof={addressProof}
                addressConfirmed={addressConfirmed}
                callbackUrl={callbackUrl}
                // This address arrived on a link that has just been spent, so
                // there is no step behind this one to go back to. Changing it
                // means starting a sign-up over, which is what this does.
                onUseDifferentEmail={() => {
                  forgetHeldAddressProof();
                  hardRedirect("/auth/signup");
                }}
              />
            ) : null
          }
        />
      ) : null}
      <LogInLink callbackUrl={callbackUrl} label="Or log in instead" />
    </AuthCard>
  );
}

/**
 * What this instance offers with no address in hand, so the same social
 * buttons the log-in screen shows are available here from the first step.
 */
function useInstanceMethods({
  decide,
  verifyToken,
}: {
  decide: (input: { identifier: null }) => Promise<RoutingDecision | null>;
  verifyToken: string | null | undefined;
}): readonly SignInMethod[] {
  const [instanceMethods, setInstanceMethods] = useState<readonly SignInMethod[]>([]);
  const askedOnMount = useRef(false);

  useEffect(() => {
    if (askedOnMount.current || verifyToken) return;
    askedOnMount.current = true;
    void decide({ identifier: null }).then((decision) => {
      // Never an existing passkey: on the door that makes accounts, it signs somebody else in.
      if (decision?.outcome === "method_picker") {
        setInstanceMethods(decision.methodSet.filter((method) => method.kind !== "passkey"));
      }
    });
  }, [decide, verifyToken]);

  return instanceMethods;
}

/** The proven address's enrollment, and the failed link a retry re-asks with. */
function useProofEnrollment({
  decide,
  routingError,
  onWelcomeBack,
  onRouted,
  onEnrolled,
}: {
  decide: (input: { identifier: string }) => Promise<RoutingDecision | null>;
  routingError: unknown;
  onWelcomeBack: (email: string) => void;
  onRouted: (email: string) => void;
  onEnrolled: (email: string, proof: string) => void;
}) {
  const { mutateAsync: requestEnrollment, error } = api.auth.signUpEnrollment.useMutation();
  const [enrollment, setEnrollment] = useState<SignUpEnrollment | null>(null);
  const [failedLink, setFailedLink] = useState<{ email: string; addressProof: string } | null>(
    null,
  );

  const resolveEnrollment = useCallback(
    async (email: string, proof: string) => {
      const next = await nextStepForProof({ email, proof, requestEnrollment, decide });
      setFailedLink(next.kind === "retry" ? { email, addressProof: proof } : null);
      if (next.kind === "welcome_back") onWelcomeBack(email);
      if (next.kind === "routed") onRouted(email);
      if (next.kind !== "enroll") return;

      setEnrollment(next.enrollment);
      onEnrolled(email, proof);
    },
    [decide, requestEnrollment, onWelcomeBack, onRouted, onEnrolled],
  );

  /** A held proof the server still enrols resumes its step; any other answer drops it quietly. */
  const restoreEnrollment = useCallback(
    async ({ email, addressProof: proof }: HeldAddressProof) => {
      const answer = await requestEnrollment({ email, addressProof: proof }).catch(() => null);
      if (answer?.outcome !== "enroll") {
        forgetHeldAddressProof();
        return;
      }
      setEnrollment(answer);
      onEnrolled(email, proof);
    },
    [requestEnrollment, onEnrolled],
  );

  return {
    enrollment,
    failedLink,
    resolveEnrollment,
    restoreEnrollment,
    failure: error ?? routingError,
  };
}

/** Asks once, on arrival without a link, whether this tab's held proof still enrols. */
function useHeldProofRestore({
  verifyToken,
  restoreEnrollment,
}: {
  verifyToken: string | null | undefined;
  restoreEnrollment: (held: HeldAddressProof) => Promise<void>;
}): boolean {
  const [held] = useState(() => (verifyToken ? null : takeHeldAddressProofOnReload()));
  const [isRestoring, setIsRestoring] = useState(held !== null);
  const asked = useRef(false);

  useEffect(() => {
    if (!held || asked.current) return;
    asked.current = true;
    void restoreEnrollment(held).finally(() => setIsRestoring(false));
  }, [held, restoreEnrollment]);

  return isRestoring;
}

type ProofStep =
  | { kind: "enroll"; enrollment: SignUpEnrollment }
  | { kind: "routed" }
  | { kind: "welcome_back" }
  | { kind: "retry" };

/**
 * Where a proven address goes: its enrollment, the identity provider its domain now routes
 * to, the log-in step, or a retry that offers nothing.
 */
async function nextStepForProof({
  email,
  proof,
  requestEnrollment,
  decide,
}: {
  email: string;
  proof: string;
  requestEnrollment: (input: { email: string; addressProof: string }) => Promise<SignUpEnrollment>;
  decide: (input: { identifier: string }) => Promise<RoutingDecision | null>;
}): Promise<ProofStep> {
  try {
    const answer = await requestEnrollment({ email, addressProof: proof });
    if (answer.outcome === "enroll") return { kind: "enroll", enrollment: answer };
    if (answer.outcome === "unavailable") return { kind: "retry" };

    const routed = await decide({ identifier: email });
    if (routed?.outcome === "redirect_to_connection") return { kind: "routed" };
    return routed?.outcome === "method_picker" ? { kind: "welcome_back" } : { kind: "retry" };
  } catch {
    return { kind: "retry" };
  }
}

/** The address is confirmed but where it signs in could not be decided: retry, offer nothing. */
function PostLinkRoutingFailure({
  addressConfirmed,
  error,
  onRetry,
}: {
  addressConfirmed: boolean;
  error: unknown;
  onRetry: () => Promise<void>;
}) {
  return (
    <AuthCard
      title={addressConfirmed ? "Your email is confirmed" : "Create your LangWatch account"}
    >
      <div data-testid="post-link-routing-failure" hidden />
      {error ? (
        <HandledErrorAlert error={error} fallbackTitle="Couldn't check how you should sign in" />
      ) : (
        <Text>We couldn't check how this address should sign in.</Text>
      )}
      <FrontDoorPrimaryButton onClick={() => void onRetry()}>Try again</FrontDoorPrimaryButton>
    </AuthCard>
  );
}

function LogInLink({ callbackUrl, label }: { callbackUrl: string | undefined; label: string }) {
  const href = `/auth/signin${
    callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""
  }`;

  return <SecondaryActionLink href={href} label={label} testId="go-to-sign-in" />;
}

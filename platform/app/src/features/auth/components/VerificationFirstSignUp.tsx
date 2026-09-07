import { HStack, Text } from "@chakra-ui/react";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { HandledErrorAlert, readHandledError } from "~/features/errors";
import { api } from "~/utils/api";
import { signIn } from "~/utils/auth-client";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { hardRedirect } from "~/utils/hardRedirect";
import {
  useAuthAnalytics,
  usePublishAuthStep,
} from "../hooks/useAuthAnalytics";
import { useSignInRouting } from "../hooks/useSignInRouting";
import { AUTH_SURFACE, SIGN_UP_STEP } from "../logic/authAnalytics";
import { forgetCarriedEmail, readCarriedEmail } from "../logic/carriedEmail";
import { confirmSignUpAddress } from "../logic/confirmSignUpAddress";
import type { AuthDepth } from "../logic/groundPalette";
import { usePublishAuthStage } from "../logic/groundStage";
import {
  readLastUsedMethodId,
  rememberPendingMethod,
} from "../logic/lastUsedMethod";
import { usePasskeyCeremony } from "../logic/passkeyCeremony";
import { JOIN_BEFORE_CREATE_PATH } from "../logic/signUpDestination";
import { useTwoStepChallenge } from "../logic/twoStepChallenge";
import { AuthFinePrint } from "./AuthFinePrint";
import { CheckYourEmail } from "./CheckYourEmail";
import { CredentialSignInForm } from "./CredentialSignInForm";
import { RoutedToConnection } from "./IdentifierFirstSignIn";
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
import { SignUpCredentialForm } from "./SignUpCredentialForm";
import { SuccessPulse } from "./SuccessPulse";
import {
  TwoStepChallengePanel,
  twoStepChallengeTitle,
} from "./TwoStepChallengePanel";

/**
 * Sign-up (D13, ADR-117 §6).
 *
 * The same funnel as log-in, entered from the other side:
 *
 *   address ─► password or passkey ─► account, link sent ─► confirm ─► in
 *
 * The address is confirmed BEFORE anybody gets in. The account is created by
 * the credential step, because a passkey cannot be enrolled against an
 * account that does not exist yet — but no session is opened for it, and the
 * emailed link is what opens the first one. So an account whose address was
 * never confirmed is an account nobody has ever signed into.
 *
 * The link is sent by the same server call that creates the account, not by
 * this screen. That is what lets sign-up open no session and still send mail:
 * the address being mailed is provably the one just registered, where a public
 * "send a confirmation to this address" would be a mailer pointed at anything.
 *
 * An abandoned sign-up at the ADDRESS step still leaves nothing: that step
 * sends no mail and creates no account, so it costs whoever typed it exactly
 * nothing.
 *
 * An address that already has an account is not a wall (epic Q12 lets sign-up
 * acknowledge it). It is a person who came in the wrong door, so the screen
 * becomes the log-in method step with their address already in it: nothing
 * retyped, and the way into a half-created account — reset the password — is
 * on the same card.
 */
export function VerificationFirstSignUp() {
  const query = useSearchParams();
  const callbackUrl = query?.get("callbackUrl") ?? undefined;
  const verifyToken = query?.get("verify");
  // Carried in the FRAGMENT, so the address the log-in door hands over never
  // travelled on a request line. Read at first paint because the field it
  // prefills is drawn then, and forgotten immediately after — see
  // `carriedEmail`.
  const [carriedEmail] = useState(readCarriedEmail);
  useEffect(forgetCarriedEmail, []);

  const requestVerification = api.auth.requestSignUpVerification.useMutation();
  // The link is spent against the better-auth endpoint rather than a tRPC
  // procedure, because a link spent on an existing account opens that
  // account's first session — a cookie, which tRPC cannot set. See
  // `confirmSignUpAddress`. Its refusal is held here, in the REST body shape
  // the registry reads.
  const [linkError, setLinkError] = useState<unknown>(null);
  // The address the link signed in, once it has: the card becomes the
  // hand-off into the app and nothing else is asked.
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const routing = useSignInRouting();
  const { decide } = routing;
  const report = useAuthAnalytics(AUTH_SURFACE.signUp);

  const [sentTo, setSentTo] = useState<string | null>(null);
  // The address typed on the first step, on its way to the password step.
  // Nothing has been created or sent yet — this is somebody mid-sign-up.
  const [signingUpEmail, setSigningUpEmail] = useState<string | null>(null);
  // The address belongs to a domain its organization routes through an
  // identity provider, so there is no account for this screen to create: the
  // provider makes it. Held so the hand-off card can take the screen.
  const [routedEmail, setRoutedEmail] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  // The single-use proof that the link confirmed this address, for the case
  // where there was no account to mark: it rides to `user.register` so the
  // account it creates is born confirmed rather than mailed a second link.
  const [addressProof, setAddressProof] = useState<string | null>(null);
  const [accountIsReady, setAccountIsReady] = useState(false);
  const [welcomeBackEmail, setWelcomeBackEmail] = useState<string | null>(null);
  const [instanceMethods, setInstanceMethods] = useState<
    readonly SignInMethod[]
  >([]);
  const [lastUsedMethodId] = useState(() => readLastUsedMethodId());
  // Every failure this card can have shows in one place, at the top. A
  // passkey is refused from a button part-way down the rail of methods, and
  // an alert opening there pushes the rest of the rail down the page.
  const [passkeyError, setPasskeyError] = useState<unknown>(null);
  // A ceremony somebody deliberately started, published from whichever passkey
  // button they pressed.
  const passkeyCeremony = usePasskeyCeremony();
  // The welcome-back step below is the log-in password form, so this door can
  // reach a second factor too — and it draws the same card the other one does.
  const twoStep = useTwoStepChallenge();
  const spent = useRef(false);
  const askedOnMount = useRef(false);

  // The emailed link is spent once, on arrival. Guarded by a ref rather than
  // by mutation state because the token is single-use: a second attempt would
  // fail on a link that worked.
  useEffect(() => {
    if (!verifyToken || spent.current) return;
    spent.current = true;
    confirmSignUpAddress({ token: verifyToken })
      .then(
        async ({
          email,
          accountCreated,
          accountExists,
          addressProof,
          signedIn,
        }) => {
          report.linkConfirmed({ accountCreated, accountExists });
          // The link opened the session. Nothing is left to choose, so the
          // screen goes straight in — a full navigation, because the cookie
          // was set by the request that just answered and everything cached
          // under "signed out" has to go with it.
          if (signedIn) {
            setSignedInAs(email);
            hardRedirect(callbackUrl ?? JOIN_BEFORE_CREATE_PATH);
            return;
          }
          setVerifiedEmail(email);
          setAddressProof(addressProof);
          // "Ready" means there is nothing left to choose. An account that
          // was already there is just as ready as one this link created —
          // this is the link reopened inside its grace window, which confirms
          // again but opens no second session, so the way in is offered.
          setAccountIsReady(accountCreated || accountExists);
          await decide({ identifier: email });
        },
      )
      .catch((failure: unknown) => {
        // Rendered below, through the registry. The dead link is a step of
        // the funnel too, and a common one: a link opened twice, or opened a
        // day late.
        setLinkError(failure);
        report.refused("link", readHandledError(failure)?.code ?? null);
      });
  }, [verifyToken, callbackUrl, decide, report]);

  // What this instance offers with no address in hand, so the same social
  // buttons the log-in screen shows are available here from the first step.
  //
  // Every way in EXCEPT an existing passkey. A passkey ceremony started from
  // here is a discoverable-credential request: the browser offers every
  // passkey it holds for this site and picking one signs THAT account in. On
  // the door whose whole purpose is to make a new account that is not another
  // way to finish — it is a way to end up silently signed in as somebody else,
  // and it looks like it worked. The passkey this door does offer is on the
  // credential step, where it CREATES one for the address being registered
  // (D07). Somebody who already has one is not stranded: "Or log in instead"
  // is on the card and carries the address they typed.
  useEffect(() => {
    if (askedOnMount.current || verifyToken) return;
    askedOnMount.current = true;
    void decide({ identifier: null }).then((decision) => {
      if (decision?.outcome === "method_picker") {
        setInstanceMethods(
          decision.methodSet.filter((method) => method.kind !== "passkey"),
        );
      }
    });
  }, [decide, verifyToken]);

  const dialFederated = (method: SignInMethod) => {
    report.chose(method.id);
    rememberPendingMethod(method);
    void signIn(method.id, {
      callbackUrl: callbackUrl ?? JOIN_BEFORE_CREATE_PATH,
    });
  };

  const sendTo = async (email: string) => {
    try {
      await requestVerification.mutateAsync({ email });
      setSentTo(email);
    } catch (failure) {
      // Not a refusal, a wrong door: the address has an account, so the screen
      // turns into the way into it rather than telling somebody to start again
      // somewhere else.
      if (readHandledError(failure)?.code === "email_already_registered") {
        setWelcomeBackEmail(email);
        await decide({ identifier: email });
        return;
      }
      // Anything else renders from the mutation's error, through the registry.
    }
  };

  // Told once, from the same state the returns below branch on, so the ground
  // can never be showing a step other than the one drawn over it. A confirmed
  // address being asked for a password is the same DEPTH as a log-in asking
  // for one — the field does not care which door reached it, only how far in
  // it is.
  usePublishAuthStage({
    door: "signup",
    depth: signUpDepth({
      challenged: twoStep !== null,
      // A link that signed them in is as settled as a confirmed account with
      // its way in on screen: the ground reads the same for both.
      verifiedEmail: signedInAs ?? verifiedEmail,
      accountIsReady: accountIsReady || signedInAs !== null,
      welcomeBackEmail,
      sentTo,
      signingUpEmail,
      routedEmail,
    }),
  });

  // Read from the same state, in the same order, for the same reason: the
  // funnel's steps and the screen's steps have to be the same list or the
  // drop-off between them measures nothing.
  usePublishAuthStep({
    surface: AUTH_SURFACE.signUp,
    step: signUpStep({
      challenged: twoStep !== null,
      ceremony: passkeyCeremony !== null,
      verifiedEmail: signedInAs ?? verifiedEmail,
      accountIsReady: accountIsReady || signedInAs !== null,
      welcomeBackEmail,
      sentTo,
      signingUpEmail,
      routedEmail,
      linkIsDead: Boolean(verifyToken && linkError),
    }),
    attributes: {
      // The SHAPE of the address, never the address: whether the log-in
      // screen handed one over is what says how somebody arrived here.
      hadCarriedAddress: Boolean(carriedEmail),
      arrivedOnLink: Boolean(verifyToken),
    },
  });

  // Ahead of everything, the same as on the log-in door: a password has
  // already been accepted, so no earlier step is the question any more.
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

  // A ceremony somebody deliberately started takes the card, the same way it
  // does on the log-in door. See `logic/passkeyCeremony.ts` — the offer from
  // the address field never reaches here.
  if (passkeyCeremony) {
    return (
      <AuthCard title={passkeyCeremonyTitle(passkeyCeremony)}>
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
        onUseDifferentEmail={() => setWelcomeBackEmail(null)}
      />
    );
  }

  // The link signed them in. The navigation is already under way; this is the
  // card it leaves behind for the moment it takes, and it asks for nothing.
  if (signedInAs) {
    return (
      <AuthCard title="You're in">
        <HStack gap={3}>
          <SuccessPulse label="Signed in" />
          <Text data-testid="signed-in-handoff">
            {signedInAs} is confirmed. Taking you to LangWatch.
          </Text>
        </HStack>
      </AuthCard>
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

  if (verifiedEmail) {
    return (
      <MethodChoice
        verifiedEmail={verifiedEmail}
        addressProof={addressProof}
        decision={routing.decision}
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

  // Ahead of the credential step, deliberately: this address is not ours to
  // hold a credential for. Its organization routes the domain through an
  // identity provider, so the account is made there and a password box here
  // would be a way to create the exact thing the connection forbids.
  if (routedEmail && routing.decision?.outcome === "redirect_to_connection") {
    return (
      <RoutedToConnection
        decision={routing.decision}
        onContinue={dialFederated}
        callbackUrl={callbackUrl ?? JOIN_BEFORE_CREATE_PATH}
        title="Create your LangWatch account"
        footer={
          <LogInLink callbackUrl={callbackUrl} label="Or log in instead" />
        }
      />
    );
  }

  // The credential step, which is the step that creates the account. It takes
  // a passkey or a password — named for the choice rather than for one of its
  // answers. It does NOT sign anybody in: the account is created, the server
  // sends the confirmation link on the same call, and the screen becomes
  // "check your email". The address is confirmed before anybody gets in.
  if (signingUpEmail) {
    return (
      <AuthCard title="Choose how to sign in" finePrint={<AuthFinePrint />}>
        <SignUpCredentialForm
          email={signingUpEmail}
          callbackUrl={callbackUrl ?? JOIN_BEFORE_CREATE_PATH}
          onUseDifferentEmail={() => setSigningUpEmail(null)}
          onAwaitingConfirmation={(email, method) => {
            report.accountCreated(method);
            report.linkSent("address_confirmation");
            setSigningUpEmail(null);
            setSentTo(email);
          }}
          onAddressAlreadyRegistered={() => {
            report.refused("address", "email_already_registered");
            setSigningUpEmail(null);
            setWelcomeBackEmail(signingUpEmail);
            void decide({ identifier: signingUpEmail });
          }}
        />
        {/* The other door, on this stage as on every other. It matters most
            HERE: this door deliberately offers no EXISTING passkey, so for
            somebody who already has an account and came to the wrong page,
            this link is the way on — rather than a ceremony that would have
            signed them into that account by accident, mid-sign-up. */}
        <LogInLink callbackUrl={callbackUrl} label="Or log in instead" />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your LangWatch account"
      finePrint={<AuthFinePrint />}
    >
      {requestVerification.error ? (
        <HandledErrorAlert
          error={requestVerification.error}
          fallbackTitle="Couldn't start your sign-up"
          className="lw-auth-alert"
        />
      ) : null}
      {/* The router decides whether this address may hold a password at all,
          so a failure here is not a detail to swallow — it is the reason the
          journey stopped, and it belongs on screen with a way to try again. */}
      <HandledErrorAlert
        error={routing.error}
        fallbackTitle="Couldn't check how you sign in"
        className="lw-auth-alert"
      />
      <HandledErrorAlert
        error={passkeyError}
        fallbackTitle="Could not use a passkey"
        className="lw-auth-alert"
      />
      <IdentifierStepForm
        submitLabel="Continue"
        isSubmitting={requestVerification.isPending || routing.isDeciding}
        defaultEmail={carriedEmail}
        // The same question the log-in screen asks, and for the same reason:
        // the ROUTER decides what this address is offered, not the screen.
        //
        // Sign-up used to skip it and go straight to a password, which meant
        // somebody whose company has registered a single sign-on connection
        // could create a password account on that domain — the one thing the
        // connection exists to prevent. The router already answers this
        // correctly: a live domain connection outranks "no account for this
        // address" in its table, so it says `redirect_to_connection` for an
        // address that has no account at all. Nothing here decides; it asks.
        //
        // Nothing is sent from this step either way: the account is created on
        // the next one, so an address typed here costs nobody an email.
        onSubmit={async ({ email }) => {
          report.submitted("address", {
            hadCarriedAddress: Boolean(carriedEmail),
          });
          const decision = await decide({ identifier: email });
          if (decision?.outcome === "redirect_to_connection") {
            setRoutedEmail(email);
            return;
          }
          // NO ANSWER IS NOT "NO CONNECTION". `decide` swallows every failure
          // and returns null, so a routing outage — or simply spending the
          // per-address budget from a shared office network — used to fall
          // straight through to the password step and mint a password account
          // on a domain that routes through an identity provider, which is
          // the one thing the connection exists to prevent. The error is
          // rendered above; stopping here is what makes it mean something.
          if (!decision) return;
          setSigningUpEmail(email);
        }}
        footer={
          <LogInLink callbackUrl={callbackUrl} label="Or log in instead" />
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
      <HandledErrorAlert
        error={passkeyError}
        fallbackTitle="Could not use a passkey"
        className="lw-auth-alert"
      />
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
 * The link came back for an address that already has an account, which is now
 * the ordinary end of sign-up: the credential step made the account and this
 * is the address catching up with it. Confirming is the last thing between
 * somebody and their first session.
 *
 * The methods are the ROUTED ones rather than a password form, because the
 * credential the account holds may not be a password: somebody who signed up
 * with a passkey has no password to type, and offering them one would be a
 * dead end on the screen that is supposed to let them in. Same picker as the
 * log-in screen, so the two can never come to offer different things.
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
      <HandledErrorAlert
        error={passkeyError}
        fallbackTitle="Could not use a passkey"
        className="lw-auth-alert"
      />
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
  onResend: (email: string) => void | Promise<unknown>;
}) {
  return (
    <AuthCard
      title="Create your LangWatch account"
      intro="Enter your email and we will send a new confirmation link."
    >
      <HandledErrorAlert
        error={error}
        fallbackTitle="That confirmation link no longer works"
      />
      <IdentifierStepForm
        submitLabel="Send a new link"
        isSubmitting={isSending}
        onSubmit={({ email }) => onResend(email)}
        // The way to the other door, on this stage too. A link that expired is
        // often a link somebody already used on another device, so the person
        // reading this may well have an account already — and burning a fresh
        // one to find that out is the round trip this saves.
        footer={
          <LogInLink callbackUrl={callbackUrl} label="Or log in instead" />
        }
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
  challenged,
  verifiedEmail,
  accountIsReady,
  welcomeBackEmail,
  sentTo,
  signingUpEmail,
  routedEmail,
}: {
  challenged: boolean;
  verifiedEmail: string | null;
  accountIsReady: boolean;
  welcomeBackEmail: string | null;
  sentTo: string | null;
  signingUpEmail: string | null;
  routedEmail: string | null;
}): AuthDepth {
  if (challenged) return "challenge";
  if (verifiedEmail && accountIsReady) return "settled";
  if (
    verifiedEmail !== null ||
    welcomeBackEmail !== null ||
    signingUpEmail !== null ||
    // The hand-off is as far in as the credential step it replaces: the
    // address has been answered for, and what is on screen is the way through.
    routedEmail !== null
  ) {
    return "credential";
  }
  if (sentTo !== null) return "sent";
  return "entry";
}

/**
 * Which step of sign-up the funnel is being told about.
 *
 * Separate from `signUpDepth` on purpose, though both read the same state. The
 * depth is how far in the GROUND should look, and several steps deliberately
 * share one — the credential step and the welcome-back step are both
 * "credential", because the ground does not care which door reached it. The
 * funnel cares very much: those two are the difference between somebody making
 * an account and somebody discovering they already had one. So this names
 * every step separately, and is read in the order the returns are written in.
 */
function signUpStep({
  challenged,
  ceremony,
  verifiedEmail,
  accountIsReady,
  welcomeBackEmail,
  sentTo,
  signingUpEmail,
  routedEmail,
  linkIsDead,
}: {
  challenged: boolean;
  ceremony: boolean;
  verifiedEmail: string | null;
  accountIsReady: boolean;
  welcomeBackEmail: string | null;
  sentTo: string | null;
  signingUpEmail: string | null;
  routedEmail: string | null;
  linkIsDead: boolean;
}): string {
  if (challenged) return SIGN_UP_STEP.challenge;
  if (ceremony) return SIGN_UP_STEP.passkeyCeremony;
  if (welcomeBackEmail !== null) return SIGN_UP_STEP.welcomeBack;
  if (verifiedEmail !== null && accountIsReady)
    return SIGN_UP_STEP.accountReady;
  if (verifiedEmail !== null) return SIGN_UP_STEP.methodChoice;
  if (sentTo !== null) return SIGN_UP_STEP.checkEmail;
  if (linkIsDead) return SIGN_UP_STEP.linkDead;
  if (routedEmail !== null) return SIGN_UP_STEP.routedToConnection;
  if (signingUpEmail !== null) return SIGN_UP_STEP.credential;
  return SIGN_UP_STEP.address;
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
  decision,
  lastUsedMethodId,
  callbackUrl,
  onFederatedMethodChosen,
}: {
  verifiedEmail: string;
  /** The spent link's proof, on its way to the account it will confirm. */
  addressProof: string | null;
  decision: RoutingDecision | null;
  lastUsedMethodId: string | null;
  callbackUrl: string;
  onFederatedMethodChosen: (method: SignInMethod) => void;
}) {
  return (
    <AuthCard title="Choose how to sign in">
      <HStack gap={3}>
        <SuccessPulse label="Email address confirmed" />
        <Text data-testid="verified-address">
          {verifiedEmail} is confirmed.
        </Text>
      </HStack>
      {decision ? (
        <SignInMethodPicker
          // Every way in EXCEPT a passkey. This step belongs to an account
          // being made: there is no credential on this device to find yet, so
          // the ceremony would open a prompt with nothing in it. A passkey
          // becomes an offer once there is one to enrol (D07).
          methodSet={decision.methodSet.filter(
            (method) => method.kind !== "passkey",
          )}
          reasonCode={decision.reasonCode}
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
                callbackUrl={callbackUrl}
                // The link has been spent, so this address is proved: the
                // account this creates is signed straight into rather than
                // sent another confirmation.
                addressIsConfirmed
                addressProof={addressProof}
                // This address arrived on a link that has just been spent, so
                // there is no step behind this one to go back to. Changing it
                // means starting a sign-up over, which is what this does.
                onUseDifferentEmail={() => hardRedirect("/auth/signup")}
              />
            ) : null
          }
        />
      ) : null}
    </AuthCard>
  );
}

function LogInLink({
  callbackUrl,
  label,
}: {
  callbackUrl: string | undefined;
  label: string;
}) {
  const href = `/auth/signin${
    callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""
  }`;

  return (
    <SecondaryActionLink href={href} label={label} testId="go-to-sign-in" />
  );
}

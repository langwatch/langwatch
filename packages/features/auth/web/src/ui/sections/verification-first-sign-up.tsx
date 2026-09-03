import { Box, HStack, Text } from "@chakra-ui/react";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity-contract";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "../elements/auth-card";
import { HandledErrorAlert } from "../elements/handled-error-alert";
import { readHandledError } from "../../model/read-handled-error";
import { authApi as api } from "../../behavior/auth-api";
import { signIn } from "../../behavior/auth-client";
import Link from "../elements/router-link";
import { useSearchParams } from "../../behavior/use-route";
import { hardRedirect } from "../../behavior/hard-redirect";
import { useSignInRouting } from "../../behavior/use-sign-in-routing";
import { forgetCarriedEmail, readCarriedEmail } from "../../model/carried-email";
import type { FrontDoorDepth } from "../../model/ground-palette";
import { usePublishFrontDoorStage } from "../../model/ground-stage";
import { readLastUsedMethodId, rememberPendingMethod } from "../../model/last-used-method";
import { CheckYourEmail } from "../elements/check-your-email";
import { CredentialSignInForm } from "./credential-sign-in-form";
import { FrontDoorFinePrint } from "../elements/front-door-fine-print";
import { IdentifierStepForm } from "./identifier-step-form";
import {
  AlternativeMethods,
  hasAlternativeMethods,
  SignInMethodPicker,
} from "../blocks/sign-in-method-picker";
import { SignUpCredentialForm } from "./sign-up-credential-form";
import { SuccessPulse } from "../elements/success-pulse";

/**
 * Where a new account goes before it makes an organization: the
 * join-before-create step (D12 fills it; today it passes straight through).
 */
const JOIN_BEFORE_CREATE_PATH = "/auth/join";

/**
 * Sign-up (D13, ADR-117 §6, revised).
 *
 * The same funnel as log-in, entered from the other side: an address, then a
 * password, and the account exists. Confirming the address FOLLOWS somebody in
 * rather than standing in front of them — the link goes out once they are
 * already through the door, because waiting on an inbox is a wall in front of
 * the thing they came to do, and it is a wall that buys nothing. Everything
 * that actually trusts the address is gated on the identifier being verified,
 * not on the account existing; domain auto-join is the one that matters, and
 * it already refuses an unverified address.
 *
 * An abandoned sign-up still leaves nothing: the address step sends no mail
 * and creates no account, so it costs whoever typed it exactly nothing.
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

  const requestVerification = api.frontDoor.requestSignUpVerification.useMutation();
  const completeVerification = api.frontDoor.completeSignUpVerification.useMutation();
  const routing = useSignInRouting();
  const { decide } = routing;

  const [sentTo, setSentTo] = useState<string | null>(null);
  // The address typed on the first step, on its way to the password step.
  // Nothing has been created or sent yet — this is somebody mid-sign-up.
  const [signingUpEmail, setSigningUpEmail] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [accountIsReady, setAccountIsReady] = useState(false);
  const [welcomeBackEmail, setWelcomeBackEmail] = useState<string | null>(null);
  const [instanceMethods, setInstanceMethods] = useState<readonly SignInMethod[]>([]);
  const [lastUsedMethodId] = useState(() => readLastUsedMethodId());
  // Every failure this card can have shows in one place, at the top. A
  // passkey is refused from a button part-way down the rail of methods, and
  // an alert opening there pushes the rest of the rail down the page.
  const [passkeyError, setPasskeyError] = useState<unknown>(null);
  const spent = useRef(false);
  const askedOnMount = useRef(false);

  // The emailed link is spent once, on arrival. Guarded by a ref rather than
  // by mutation state because the token is single-use: a second attempt would
  // fail on a link that worked.
  useEffect(() => {
    if (!verifyToken || spent.current) return;
    spent.current = true;
    completeVerification
      .mutateAsync({ token: verifyToken })
      .then(async ({ email, accountCreated, accountExists }) => {
        setVerifiedEmail(email);
        // "Ready" means there is nothing left to choose. An account that was
        // already there is just as ready as one this link created — sign-up
        // made it and the link is the address catching up, so asking such a
        // person to pick a sign-in method would be asking twice.
        setAccountIsReady(accountCreated || accountExists);
        await decide({ identifier: email });
      })
      .catch(() => {
        // Rendered from the mutation's error below, through the registry.
      });
  }, [verifyToken, completeVerification, decide]);

  // What this instance offers with no address in hand, so the same social
  // buttons the log-in screen shows are available here from the first step.
  useEffect(() => {
    if (askedOnMount.current || verifyToken) return;
    askedOnMount.current = true;
    void decide({ identifier: null }).then((decision) => {
      if (decision?.outcome === "method_picker") {
        setInstanceMethods(decision.methodSet);
      }
    });
  }, [decide, verifyToken]);

  const dialFederated = (method: SignInMethod) => {
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
  usePublishFrontDoorStage({
    door: "signup",
    depth: signUpDepth({
      verifiedEmail,
      accountIsReady,
      welcomeBackEmail,
      sentTo,
      signingUpEmail,
    }),
  });

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

  if (verifiedEmail && accountIsReady) {
    return (
      <AccountIsReady email={verifiedEmail} callbackUrl={callbackUrl ?? JOIN_BEFORE_CREATE_PATH} />
    );
  }

  if (verifiedEmail) {
    return (
      <MethodChoice
        verifiedEmail={verifiedEmail}
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
        what="Open it to confirm the address."
        onUseDifferentEmail={() => setSentTo(null)}
      />
    );
  }

  if (verifyToken && completeVerification.error) {
    return (
      <LinkNoLongerWorks
        error={completeVerification.error}
        isSending={requestVerification.isPending}
        onResend={sendTo}
      />
    );
  }

  // The credential step, which is the step that creates the account. It takes
  // a passkey or a password — named for the choice rather than for one of its
  // answers. Confirming the address happens after it and gates nothing.
  if (signingUpEmail) {
    return (
      <AuthCard title="Choose how to sign in" finePrint={<FrontDoorFinePrint />}>
        <SignUpCredentialForm
          email={signingUpEmail}
          callbackUrl={callbackUrl ?? JOIN_BEFORE_CREATE_PATH}
          onUseDifferentEmail={() => setSigningUpEmail(null)}
          onAddressAlreadyRegistered={() => {
            setSigningUpEmail(null);
            setWelcomeBackEmail(signingUpEmail);
            void decide({ identifier: signingUpEmail });
          }}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your LangWatch account" finePrint={<FrontDoorFinePrint />}>
      {requestVerification.error ? (
        <HandledErrorAlert
          error={requestVerification.error}
          fallbackTitle="Couldn't start your sign-up"
          className="lw-front-door-alert"
        />
      ) : null}
      <HandledErrorAlert
        error={passkeyError}
        fallbackTitle="Could not use a passkey"
        className="lw-front-door-alert"
      />
      <IdentifierStepForm
        submitLabel="Continue"
        isSubmitting={requestVerification.isPending}
        defaultEmail={carriedEmail}
        // Straight to the password. Nothing is sent from this step any more:
        // the account is created on the next one and the confirmation follows
        // it out, so an address typed here costs nobody an email.
        onSubmit={({ email }) => {
          setSigningUpEmail(email);
          return Promise.resolve();
        }}
        footer={<LogInLink callbackUrl={callbackUrl} label="Already have an account? Log in" />}
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
        className="lw-front-door-alert"
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
 * The link carried a credential, so confirming it finished the job: the
 * account exists. All that is left is the log-in it was always going to be,
 * with the address in place and the password the browser has just saved.
 */
function AccountIsReady({ email, callbackUrl }: { email: string; callbackUrl: string }) {
  return (
    <AuthCard title="Your account is ready">
      <HStack gap={3}>
        <SuccessPulse label="Account created" />
        <Text data-testid="account-ready">{email} is confirmed.</Text>
      </HStack>
      <CredentialSignInForm
        email={email}
        callbackUrl={callbackUrl}
        onUseDifferentEmail={() => hardRedirect("/auth/signin")}
      />
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
  onResend,
}: {
  error: unknown;
  isSending: boolean;
  onResend: (email: string) => void | Promise<unknown>;
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
  verifiedEmail,
  accountIsReady,
  welcomeBackEmail,
  sentTo,
  signingUpEmail,
}: {
  verifiedEmail: string | null;
  accountIsReady: boolean;
  welcomeBackEmail: string | null;
  sentTo: string | null;
  signingUpEmail: string | null;
}): FrontDoorDepth {
  if (verifiedEmail && accountIsReady) return "settled";
  if (verifiedEmail !== null || welcomeBackEmail !== null || signingUpEmail !== null) {
    return "credential";
  }
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
  decision,
  lastUsedMethodId,
  callbackUrl,
  onFederatedMethodChosen,
}: {
  verifiedEmail: string;
  decision: RoutingDecision | null;
  lastUsedMethodId: string | null;
  callbackUrl: string;
  onFederatedMethodChosen: (method: SignInMethod) => void;
}) {
  return (
    <AuthCard title="Choose how to sign in">
      <HStack gap={3}>
        <SuccessPulse label="Email address confirmed" />
        <Text data-testid="verified-address">{verifiedEmail} is confirmed.</Text>
      </HStack>
      {decision ? (
        <SignInMethodPicker
          // Every way in EXCEPT a passkey. This step belongs to an account
          // being made: there is no credential on this device to find yet, so
          // the ceremony would open a prompt with nothing in it. A passkey
          // becomes an offer once there is one to enrol (D07).
          methodSet={decision.methodSet.filter((method) => method.kind !== "passkey")}
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

function LogInLink({ callbackUrl, label }: { callbackUrl: string | undefined; label: string }) {
  const href = `/auth/signin${
    callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""
  }`;

  // The question reads quiet and only the answer is the link, the way the
  // board draws its footers. A label with no question is all link.
  const splitAt = label.indexOf("? ");
  const lead = splitAt === -1 ? "" : label.slice(0, splitAt + 2);
  const linked = splitAt === -1 ? label : label.slice(splitAt + 2);

  return (
    <Text width="full" textAlign="center" fontSize="13px" color="fg.muted">
      {lead}
      <Box
        asChild
        color="fg"
        fontWeight={600}
        textDecoration="underline"
        textUnderlineOffset="3px"
        textDecorationColor="border"
        _hover={{ textDecorationColor: "fg" }}
      >
        <Link viewTransition href={href}>
          {linked}
        </Link>
      </Box>
    </Text>
  );
}

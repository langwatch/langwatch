import { Box, Button, HStack, Text } from "@chakra-ui/react";
import type { SignUpEnrollment, SignUpVerificationResult } from "@langwatch/auth-contract";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import { authApi as api } from "../../behavior/auth-api.ts";
import { signIn } from "../../behavior/auth-client.tsx";
import { hardRedirect } from "../../behavior/hard-redirect.ts";
import { useSearchParams } from "../../behavior/use-route.ts";
import { useSignInRouting } from "../../behavior/use-sign-in-routing.ts";
import { forgetCarriedEmail, readCarriedEmail } from "../../model/carried-email.ts";
import type { FrontDoorDepth } from "../../model/ground-palette.ts";
import { usePublishFrontDoorStage } from "../../model/ground-stage.ts";
import { readLastUsedMethodId, rememberPendingMethod } from "../../model/last-used-method.ts";
import { readHandledError } from "../../model/read-handled-error.ts";
import { AuthCard } from "../elements/auth-card.tsx";
import { CheckYourEmail } from "../elements/check-your-email.tsx";
import { HandledErrorAlert } from "../elements/handled-error-alert.tsx";
import Link from "../elements/router-link.tsx";
import { SuccessPulse } from "../elements/success-pulse.tsx";
import { CredentialSignInForm } from "./credential-sign-in-form.tsx";
import { FrontDoorFinePrint } from "./front-door-fine-print.tsx";
import { IdentifierStepForm } from "./identifier-step-form.tsx";
import {
  AlternativeMethods,
  hasAlternativeMethods,
  useShowsAllSocialMethods,
  SignInMethodPicker,
} from "./sign-in-method-picker.tsx";
import { SignUpCredentialForm } from "./sign-up-credential-form.tsx";

/**
 * Where a new account goes before it makes an organization: the
 * join-before-create step (D12 fills it; today it passes straight through).
 */
const JOIN_BEFORE_CREATE_PATH = "/auth/join";

/**
 * Sign-up (D13, ADR-117 §6): address, link, proof, then password. The account
 * is created only by spending the proof the link returned. An address with an
 * account already becomes the log-in step, pre-filled, not a wall.
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
  const completeVerification = api.auth.completeSignUpVerification.useMutation();
  const routing = useSignInRouting();
  const { decide } = routing;

  const [sentTo, setSentTo] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  // The single-use proof `user.register` spends; only where no account stands behind the address.
  const [addressProof, setAddressProof] = useState<string | null>(null);
  const [accountIsReady, setAccountIsReady] = useState(false);
  const [welcomeBackEmail, setWelcomeBackEmail] = useState<string | null>(null);
  const showsAllSocial = useShowsAllSocialMethods();
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
    onEnrolled: (email, proof) => {
      setVerifiedEmail(email);
      setAddressProof(proof);
    },
  });
  const { enrollment, failedLink, resolveEnrollment, settleSpentLink } = proofEnrollment;

  // The emailed link is spent once, on arrival. Guarded by a ref rather than
  // by mutation state because the token is single-use: a second attempt would
  // fail on a link that worked.
  useEffect(() => {
    if (!verifyToken || spent.current) return;
    spent.current = true;
    completeVerification
      .mutateAsync({ token: verifyToken })
      .then((result) =>
        settleSpentLink(
          result,
          async ({ email, accountCreated, accountExists, addressProof: proof }) => {
            setVerifiedEmail(email);
            setAddressProof(proof);
            // "Ready" means there is nothing left to choose. An account that was
            // already there is just as ready as one this link created — sign-up
            // made it and the link is the address catching up, so asking such a
            // person to pick a sign-in method would be asking twice.
            setAccountIsReady(accountCreated || accountExists);
            await decide({ identifier: email });
          },
        ),
      )
      .catch(() => {
        // Rendered from the mutation's error below, through the registry.
      });
  }, [verifyToken, completeVerification, decide, settleSpentLink]);

  const instanceMethods = useInstanceMethods({ decide, verifyToken });

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
      addressProof,
      welcomeBackEmail,
      sentTo,
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

  if (failedLink) {
    return (
      <PostLinkRoutingFailure
        error={proofEnrollment.failure}
        onRetry={() => resolveEnrollment(failedLink.email, failedLink.addressProof)}
      />
    );
  }

  if (verifiedEmail && addressProof && enrollment) {
    return (
      <MethodChoice
        verifiedEmail={verifiedEmail}
        addressProof={addressProof}
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
        // The link comes first: no credential is collected until it is opened.
        onSubmit={({ email }) => sendTo(email)}
        footer={<LogInLink callbackUrl={callbackUrl} label="Already have an account? Log in" />}
        alternatives={
          hasAlternativeMethods({ methodSet: instanceMethods, showsAllSocial }) ? (
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
  addressProof,
  welcomeBackEmail,
  sentTo,
}: {
  verifiedEmail: string | null;
  accountIsReady: boolean;
  addressProof: string | null;
  welcomeBackEmail: string | null;
  sentTo: string | null;
}): FrontDoorDepth {
  if (verifiedEmail && accountIsReady) return "settled";
  if (welcomeBackEmail !== null) return "credential";
  if (verifiedEmail !== null && addressProof !== null) return "credential";
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
  enrollment,
  lastUsedMethodId,
  callbackUrl,
  onFederatedMethodChosen,
}: {
  verifiedEmail: string;
  addressProof: string;
  enrollment: SignUpEnrollment;
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
      {enrollment ? (
        <SignInMethodPicker
          // Every way in EXCEPT a passkey. This step belongs to an account
          // being made: there is no credential on this device to find yet, so
          // the ceremony would open a prompt with nothing in it. A passkey
          // becomes an offer once there is one to enrol (D07).
          methodSet={enrollment.methodSet.filter((method) => method.kind !== "passkey")}
          reasonCode={enrollment.reasonCode}
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
      if (decision?.outcome === "method_picker") {
        setInstanceMethods(decision.methodSet);
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
  onEnrolled,
}: {
  decide: (input: { identifier: string }) => Promise<RoutingDecision | null>;
  routingError: unknown;
  onWelcomeBack: (email: string) => void;
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
      if (next.kind !== "enroll") return;

      setEnrollment(next.enrollment);
      onEnrolled(email, proof);
    },
    [decide, requestEnrollment, onWelcomeBack, onEnrolled],
  );

  /** A link that proved an address with no account asks for its enrollment; any other settles. */
  const settleSpentLink = useCallback(
    async (
      result: SignUpVerificationResult,
      settle: (result: SignUpVerificationResult) => Promise<void>,
    ) => {
      const { email, accountCreated, accountExists, addressProof } = result;
      if (addressProof && !accountCreated && !accountExists) {
        return resolveEnrollment(email, addressProof);
      }
      return settle(result);
    },
    [resolveEnrollment],
  );

  return {
    enrollment,
    failedLink,
    resolveEnrollment,
    settleSpentLink,
    failure: error ?? routingError,
  };
}

type ProofStep =
  | { kind: "enroll"; enrollment: SignUpEnrollment }
  | { kind: "welcome_back" }
  | { kind: "retry" };

/** Where a proven address goes: its enrollment, the log-in step, or a retry that offers nothing. */
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
    const signsInElsewhere =
      routed?.outcome === "redirect_to_connection" || routed?.outcome === "method_picker";
    return signsInElsewhere ? { kind: "welcome_back" } : { kind: "retry" };
  } catch {
    return { kind: "retry" };
  }
}

/** The address is confirmed but where it signs in could not be decided: retry, offer nothing. */
function PostLinkRoutingFailure({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => Promise<void>;
}) {
  return (
    <AuthCard title="Your email is confirmed">
      <div data-testid="post-link-routing-failure" hidden />
      {error ? (
        <HandledErrorAlert error={error} fallbackTitle="Couldn't check how you should sign in" />
      ) : (
        <Text>We couldn't check how this address should sign in.</Text>
      )}
      <Button className="lw-front-door-primary" width="full" onClick={() => void onRetry()}>
        Try again
      </Button>
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

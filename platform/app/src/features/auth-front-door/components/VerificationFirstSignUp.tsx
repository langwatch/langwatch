import { Box, HStack, Text } from "@chakra-ui/react";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { HandledErrorAlert, readHandledError } from "~/features/errors";
import { api } from "~/utils/api";
import Link from "~/utils/compat/next-link";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { hardRedirect } from "~/utils/hardRedirect";
import { useFrontDoorMethods } from "../hooks/useFrontDoorMethods";
import { useSignInRouting } from "../hooks/useSignInRouting";
import { CredentialSignInForm } from "./CredentialSignInForm";
import { FrontDoorFinePrint } from "./FrontDoorFinePrint";
import {
  IdentifierStepForm,
  type IdentifierStepValues,
} from "./IdentifierStepForm";
import {
  AlternativeMethods,
  hasAlternativeMethods,
  SignInMethodPicker,
} from "./SignInMethodPicker";
import { SignUpCredentialForm } from "./SignUpCredentialForm";
import { SuccessPulse } from "./SuccessPulse";

/**
 * Where a new account goes before it makes an organization: the
 * join-before-create step (D12 fills it; today it passes straight through).
 */
const JOIN_BEFORE_CREATE_PATH = "/auth/join";

/**
 * Sign-up, verification first (D13, ADR-117 §6).
 *
 * The same funnel as log-in, entered from the other side: an address, then the
 * methods the router named for it. The address is confirmed before any method
 * is chosen, so nothing exists for an address nobody proved — an abandoned
 * sign-up leaves a token that expires and nothing else.
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
  const carriedEmail = query?.get("email") ?? undefined;
  // Where sign-up lands once a method is held.
  const returnTo = callbackUrl ?? JOIN_BEFORE_CREATE_PATH;

  const routing = useSignInRouting();
  const { decide } = routing;
  const signUp = useSignUpVerification({ verifyToken, decide });

  // What this instance offers with no address in hand, so the same social
  // buttons the log-in screen shows are available here from the first step.
  const { instanceMethods, lastUsedMethodId, dialFederated } =
    useFrontDoorMethods({ decide, callbackUrl: returnTo, skip: verifyToken });

  if (signUp.welcomeBackEmail) {
    return (
      <WelcomeBack
        email={signUp.welcomeBackEmail}
        decision={routing.decision}
        lastUsedMethodId={lastUsedMethodId}
        callbackUrl={callbackUrl}
        onFederatedMethodChosen={dialFederated}
        onUseDifferentEmail={signUp.chooseDifferentEmail}
      />
    );
  }

  if (signUp.verifiedEmail && signUp.accountIsReady) {
    return (
      <AccountIsReady email={signUp.verifiedEmail} callbackUrl={returnTo} />
    );
  }

  if (signUp.verifiedEmail) {
    return (
      <MethodChoice
        verifiedEmail={signUp.verifiedEmail}
        decision={routing.decision}
        lastUsedMethodId={lastUsedMethodId}
        callbackUrl={returnTo}
        onFederatedMethodChosen={dialFederated}
      />
    );
  }

  if (verifyToken && signUp.linkError) {
    return (
      <LinkNoLongerWorks
        error={signUp.linkError}
        isSending={signUp.isSending}
        onResend={signUp.sendTo}
      />
    );
  }

  if (signUp.sentTo) return <LinkIsOnItsWay email={signUp.sentTo} />;

  return (
    <AddressStep
      carriedEmail={carriedEmail}
      callbackUrl={callbackUrl}
      sendError={signUp.sendError}
      isSending={signUp.isSending}
      onSubmit={({ email }) => signUp.sendTo(email)}
      instanceMethods={instanceMethods}
      lastUsedMethodId={lastUsedMethodId}
      onFederatedMethodChosen={dialFederated}
    />
  );
}

/**
 * The state a confirmed address costs, and nothing else: a link asked for, a
 * link spent exactly once, and what came back out of it.
 *
 * It holds no opinion about what the screen draws. The address a link
 * confirmed and the address that turned out to have an account already are two
 * separate fields, and the screen is what decides that the second one means
 * somebody came in by the wrong door.
 */
function useSignUpVerification({
  verifyToken,
  decide,
}: {
  /** The token the emailed link carried, absent on the first step. */
  verifyToken: string | null | undefined;
  decide: (input: { identifier: string | null }) => Promise<unknown>;
}): {
  /** The address a confirmation link has just gone out to. */
  sentTo: string | null;
  /** The address the link confirmed. */
  verifiedEmail: string | null;
  /** True when confirming the link also finished creating the account. */
  accountIsReady: boolean;
  /** The address that turned out to have an account already. */
  welcomeBackEmail: string | null;
  isSending: boolean;
  /** Why a link could not be asked for. */
  sendError: unknown;
  /** Why the link that arrived could not be spent. */
  linkError: unknown;
  sendTo: (email: string) => Promise<void>;
  /** Back to the address step, keeping nothing. */
  chooseDifferentEmail: () => void;
} {
  const requestVerification =
    api.frontDoor.requestSignUpVerification.useMutation();
  const completeVerification =
    api.frontDoor.completeSignUpVerification.useMutation();

  const [sentTo, setSentTo] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [accountIsReady, setAccountIsReady] = useState(false);
  const [welcomeBackEmail, setWelcomeBackEmail] = useState<string | null>(null);
  const spent = useRef(false);

  // The emailed link is spent once, on arrival. Guarded by a ref rather than
  // by mutation state because the token is single-use: a second attempt would
  // fail on a link that worked.
  useEffect(() => {
    if (!verifyToken || spent.current) return;
    spent.current = true;
    completeVerification
      .mutateAsync({ token: verifyToken })
      .then(async ({ email, accountCreated }) => {
        setVerifiedEmail(email);
        setAccountIsReady(accountCreated);
        await decide({ identifier: email });
      })
      .catch(() => {
        // Rendered from the mutation's error by the screen, through the
        // registry.
      });
  }, [verifyToken, completeVerification, decide]);

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

  return {
    sentTo,
    verifiedEmail,
    accountIsReady,
    welcomeBackEmail,
    isSending: requestVerification.isPending,
    sendError: requestVerification.error,
    linkError: completeVerification.error,
    sendTo,
    chooseDifferentEmail: () => setWelcomeBackEmail(null),
  };
}

/**
 * The first step: the address, and whatever else this instance offers beside
 * it.
 */
function AddressStep({
  carriedEmail,
  callbackUrl,
  sendError,
  isSending,
  onSubmit,
  instanceMethods,
  lastUsedMethodId,
  onFederatedMethodChosen,
}: {
  /** An address carried in from the log-in screen, so nobody types one twice. */
  carriedEmail: string | undefined;
  callbackUrl: string | undefined;
  sendError: unknown;
  isSending: boolean;
  onSubmit: (values: IdentifierStepValues) => void | Promise<unknown>;
  instanceMethods: readonly SignInMethod[];
  lastUsedMethodId: string | null;
  onFederatedMethodChosen: (method: SignInMethod) => void;
}) {
  return (
    <AuthCard
      title="Create your LangWatch account"
      intro="We will confirm your email address before anything else."
      finePrint={<FrontDoorFinePrint />}
    >
      {sendError ? (
        <HandledErrorAlert
          error={sendError}
          fallbackTitle="Couldn't start your sign-up"
        />
      ) : null}
      <IdentifierStepForm
        submitLabel="Continue"
        isSubmitting={isSending}
        defaultEmail={carriedEmail}
        onSubmit={onSubmit}
        footer={
          <LogInLink
            callbackUrl={callbackUrl}
            label="Already have an account? Log in"
          />
        }
        alternatives={
          hasAlternativeMethods(instanceMethods) ? (
            <AlternativeMethods
              methodSet={instanceMethods}
              lastUsedMethodId={lastUsedMethodId}
              onFederatedMethodChosen={onFederatedMethodChosen}
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
  return (
    // No notice, no callout, nothing that reads as a refusal: somebody who
    // clicked the wrong page gets the right page, and the only thing that
    // changes is the words on it.
    <AuthCard title="Welcome back">
      <div data-testid="welcome-back" hidden />
      {decision ? (
        <SignInMethodPicker
          methodSet={decision.methodSet}
          reasonCode={decision.reasonCode}
          lastUsedMethodId={lastUsedMethodId}
          onFederatedMethodChosen={onFederatedMethodChosen}
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
function AccountIsReady({
  email,
  callbackUrl,
}: {
  email: string;
  callbackUrl: string;
}) {
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
      <HandledErrorAlert
        error={error}
        fallbackTitle="That confirmation link no longer works"
      />
      <IdentifierStepForm
        submitLabel="Send a new link"
        isSubmitting={isSending}
        onSubmit={({ email }) => onResend(email)}
      />
    </AuthCard>
  );
}

function LinkIsOnItsWay({ email }: { email: string }) {
  return (
    <AuthCard title="Check your email">
      <Text data-testid="verification-sent">
        We sent a link to <b>{email}</b>. Open it to confirm the address and
        carry on. The link expires in 1 hour.
      </Text>
    </AuthCard>
  );
}

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
        <Text data-testid="verified-address">
          {verifiedEmail} is confirmed.
        </Text>
      </HStack>
      {decision ? (
        <SignInMethodPicker
          methodSet={decision.methodSet}
          reasonCode={decision.reasonCode}
          lastUsedMethodId={lastUsedMethodId}
          onFederatedMethodChosen={onFederatedMethodChosen}
          renderLocalMethod={(method) =>
            method.kind === "password" ? (
              <SignUpCredentialForm
                key={method.id}
                verifiedEmail={verifiedEmail}
                callbackUrl={callbackUrl}
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

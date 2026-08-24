import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { HandledErrorAlert, readHandledError } from "~/features/errors";
import { api } from "~/utils/api";
import { signIn } from "~/utils/auth-client";
import Link from "~/utils/compat/next-link";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { hardRedirect } from "~/utils/hardRedirect";
import { useSignInRouting } from "../hooks/useSignInRouting";
import {
  readLastUsedMethodId,
  rememberLastUsedMethod,
} from "../logic/lastUsedMethod";
import { CredentialSignInForm } from "./CredentialSignInForm";
import { IdentifierStepForm } from "./IdentifierStepForm";
import {
  FederatedMethodButton,
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

  const requestVerification =
    api.frontDoor.requestSignUpVerification.useMutation();
  const completeVerification =
    api.frontDoor.completeSignUpVerification.useMutation();
  const routing = useSignInRouting();
  const { decide } = routing;

  const [sentTo, setSentTo] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [accountIsReady, setAccountIsReady] = useState(false);
  const [welcomeBackEmail, setWelcomeBackEmail] = useState<string | null>(null);
  const [instanceMethods, setInstanceMethods] = useState<
    readonly SignInMethod[]
  >([]);
  const [lastUsedMethodId] = useState(() => readLastUsedMethodId());
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
      .then(async ({ email, accountCreated }) => {
        setVerifiedEmail(email);
        setAccountIsReady(accountCreated);
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
    rememberLastUsedMethod(method);
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
      <AccountIsReady
        email={verifiedEmail}
        callbackUrl={callbackUrl ?? JOIN_BEFORE_CREATE_PATH}
      />
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

  if (verifyToken && completeVerification.error) {
    return (
      <LinkNoLongerWorks
        error={completeVerification.error}
        isSending={requestVerification.isPending}
        onResend={sendTo}
      />
    );
  }

  if (sentTo) return <LinkIsOnItsWay email={sentTo} />;

  return (
    <AuthCard title="Create your LangWatch account">
      {requestVerification.error ? (
        <HandledErrorAlert
          error={requestVerification.error}
          fallbackTitle="Couldn't start your sign-up"
        />
      ) : null}
      <IdentifierStepForm
        intro="We will confirm your email address before anything else."
        submitLabel="Continue"
        isSubmitting={requestVerification.isPending}
        defaultEmail={carriedEmail}
        onSubmit={({ email }) => sendTo(email)}
        footer={
          <LogInLink
            callbackUrl={callbackUrl}
            label="Already have an account? Log in"
          />
        }
        alternatives={
          instanceMethods.length > 0 ? (
            <VStack width="full" align="stretch" gap={3}>
              {instanceMethods
                .filter((method) => method.kind === "federated")
                .map((method) => (
                  <FederatedMethodButton
                    key={method.id}
                    method={method}
                    isLastUsed={lastUsedMethodId === method.id}
                    onChosen={dialFederated}
                  />
                ))}
            </VStack>
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
    <AuthCard title="Create your LangWatch account">
      <HandledErrorAlert
        error={error}
        fallbackTitle="That confirmation link no longer works"
      />
      <IdentifierStepForm
        intro="Enter your email and we will send a new confirmation link."
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
        <Link href={href}>{linked}</Link>
      </Box>
    </Text>
  );
}

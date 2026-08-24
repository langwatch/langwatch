import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { HandledErrorAlert } from "~/features/errors";
import { normalizeErrorCode, SignInError } from "~/pages/auth/error";
import { safeRedirectTarget, signIn, useSession } from "~/utils/auth-client";
import { replaceLocation } from "~/utils/browserNavigation";
import Link from "~/utils/compat/next-link";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { useSignInRouting } from "../hooks/useSignInRouting";
import {
  readLastUsedMethodId,
  rememberLastUsedMethod,
} from "../logic/lastUsedMethod";
import {
  signInMethodActionLabel,
  signInMethodLabel,
} from "../logic/methodLabels";
import { CheckYourEmail } from "./CheckYourEmail";
import { CredentialSignInForm } from "./CredentialSignInForm";
import { IdentifierStepForm } from "./IdentifierStepForm";
import {
  FederatedMethodButton,
  SignInMethodPicker,
} from "./SignInMethodPicker";

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
 * Nothing here dead-ends. A password typed for an address nobody holds an
 * account for is not a refusal, it is a sign-up that arrived at the log-in
 * form: the credential is held, a confirmation link goes out, and the person
 * sees the same "check your email" they would have seen on the other page. A
 * password that is wrong for an account that does exist still says so, in the
 * same words it always has.
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
  const { decide } = routing;
  const askedOnMount = useRef(false);
  const [instanceMethods, setInstanceMethods] = useState<
    readonly SignInMethod[]
  >([]);
  const [lastUsedMethodId] = useState(() => readLastUsedMethodId());
  const [signingUp, setSigningUp] = useState<string | null>(null);

  useEffect(() => {
    if (session) replaceLocation(safeRedirectTarget(callbackUrl));
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

  const dialFederated = (method: SignInMethod) => {
    rememberLastUsedMethod(method);
    void signIn(method.id, { callbackUrl });
  };

  if (signingUp) {
    return (
      <CheckYourEmail
        email={signingUp}
        what="Open it to finish setting up your account."
      />
    );
  }

  if (error) return <SignInError error={error} />;

  // Nothing is painted for somebody who is already logged in: the effect
  // above is already taking them where they were going, and a card that says
  // so would only flash on the way past.
  if (session) return null;

  const decision = routing.decision;
  const submittedIdentifier = routing.identifier;

  if (routing.error) {
    return (
      <AuthCard title="Log in to LangWatch">
        <HandledErrorAlert
          error={routing.error}
          fallbackTitle="Could not start log-in"
        />
        <SignUpLink callbackUrl={callbackUrl} label="Create your account" />
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

  const showPicker = decision && (breakGlass || submittedIdentifier !== null);

  if (showPicker) {
    return (
      <AuthCard title="Log in to LangWatch">
        <SignInMethodPicker
          methodSet={decision.methodSet}
          reasonCode={decision.reasonCode}
          lastUsedMethodId={lastUsedMethodId}
          onFederatedMethodChosen={dialFederated}
          renderLocalMethod={(method) =>
            method.kind === "password" ? (
              <CredentialSignInForm
                key={method.id}
                email={submittedIdentifier ?? ""}
                callbackUrl={callbackUrl}
                onUseDifferentEmail={routing.clear}
                onSignUpStarted={setSigningUp}
              />
            ) : null
          }
        />
        {/* The switch link is always here, carrying the address already
            typed: somebody who meant to sign up gets there in one click, and
            somebody who submits a password for an address with no account is
            already carried into sign-up by the form above. */}
        <SignUpLink
          callbackUrl={callbackUrl}
          email={submittedIdentifier}
          label="Don't have an account? Sign up"
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Log in to LangWatch">
      <IdentifierStepForm
        submitLabel="Continue"
        isSubmitting={routing.isDeciding}
        onSubmit={({ email }) => decide({ identifier: email, breakGlass })}
        footer={
          <SignUpLink
            callbackUrl={callbackUrl}
            label="Don't have an account? Sign up"
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
function RoutedToConnection({
  decision,
  onContinue,
  callbackUrl,
}: {
  decision: RoutingDecision;
  onContinue: (method: SignInMethod) => void;
  callbackUrl?: string;
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
    <AuthCard title="Log in to LangWatch">
      <HStack gap={3}>
        <Spinner size="sm" color="orange.500" />
        <Text data-testid="routed-to-connection">
          Taking you to your organization's sign-in with{" "}
          {signInMethodLabel(method)}.
        </Text>
      </HStack>
      <Button colorPalette="orange" onClick={() => onContinue(method)}>
        {signInMethodActionLabel(method)}
      </Button>
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
  const params = new URLSearchParams();
  if (callbackUrl) params.set("callbackUrl", callbackUrl);
  if (email) params.set("email", email);
  const query = params.toString();

  return (
    <Box asChild>
      <Link
        href={`/auth/signup${query ? `?${query}` : ""}`}
        style={{ textDecoration: "underline" }}
      >
        {label}
      </Link>
    </Box>
  );
}

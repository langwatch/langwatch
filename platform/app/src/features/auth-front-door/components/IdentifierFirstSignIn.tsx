import { Box, Button, HStack, Spinner, Text } from "@chakra-ui/react";
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
import type { FrontDoorDepth } from "../logic/groundPalette";
import { usePublishFrontDoorStage } from "../logic/groundStage";
import {
  promotePendingMethod,
  readLastUsedMethodId,
  rememberPendingMethod,
} from "../logic/lastUsedMethod";
import {
  signInMethodActionLabel,
  signInMethodLabel,
} from "../logic/methodLabels";
import { CheckYourEmail } from "./CheckYourEmail";
import { CredentialSignInForm } from "./CredentialSignInForm";
import { FrontDoorFinePrint } from "./FrontDoorFinePrint";
import { IdentifierStepForm } from "./IdentifierStepForm";
import {
  AlternativeMethods,
  hasAlternativeMethods,
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
  // Every failure this card can have shows in one place, at the top. A
  // passkey is refused from a button part-way down the rail of methods, and
  // an alert opening there pushes the rest of the rail down the page.
  const [passkeyError, setPasskeyError] = useState<unknown>(null);

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

  const dialFederated = (method: SignInMethod) => {
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
  usePublishFrontDoorStage({
    door: "signin",
    depth: signInDepth({ signingUp, showPicker: Boolean(showPicker) }),
  });

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

  if (decision?.outcome === "redirect_to_connection") {
    return (
      <RoutedToConnection
        decision={decision}
        onContinue={dialFederated}
        callbackUrl={callbackUrl}
      />
    );
  }

  if (showPicker) {
    return (
      <AuthCard title="Log in to LangWatch">
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
          label="Don't have an account? Sign up"
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Log in to LangWatch" finePrint={<FrontDoorFinePrint />}>
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
        footer={
          <SignUpLink
            callbackUrl={callbackUrl}
            label="Don't have an account? Sign up"
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
  showPicker,
}: {
  signingUp: string | null;
  showPicker: boolean;
}): FrontDoorDepth {
  if (signingUp) return "sent";
  if (showPicker) return "credential";
  return "entry";
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
        <Link viewTransition href={`/auth/signup${query ? `?${query}` : ""}`}>
          {linked}
        </Link>
      </Box>
    </Text>
  );
}

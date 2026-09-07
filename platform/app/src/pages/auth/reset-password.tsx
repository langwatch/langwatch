import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { passwordProblem } from "@langwatch/identity";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthCard } from "~/components/auth/AuthCard";
import { AuthShell } from "~/features/auth";
import { SHAPE } from "~/features/auth/authTheme";
import { AuthField } from "~/features/auth/components/AuthField";
import {
  AUTH_PRIMARY_STYLE,
  AuthPrimaryButton,
} from "~/features/auth/components/AuthPrimaryButton";
import {
  PasskeyCeremonyPanel,
  passkeyCeremonyTitle,
} from "~/features/auth/components/PasskeyCeremonyPanel";
import { PasswordInput } from "~/features/auth/components/PasswordInput";
import {
  useAuthAnalytics,
  usePublishAuthStep,
} from "~/features/auth/hooks/useAuthAnalytics";
import { AUTH_SURFACE } from "~/features/auth/logic/authAnalytics";
import { usePublishAuthStage } from "~/features/auth/logic/groundStage";
import {
  endPasskeyCeremony,
  startPasskeyCeremony,
  usePasskeyCeremony,
} from "~/features/auth/logic/passkeyCeremony";
import { passkeyFailureFrom } from "~/features/auth/logic/passkeyFailure";
import { HandledErrorAlert } from "~/features/errors";
import { readHandledError } from "~/features/errors/logic/readHandledError";
import { authClient } from "~/utils/auth-client";
import Link from "~/utils/compat/next-link";
import { useSearchParams } from "~/utils/compat/next-navigation";

// The one password policy, from the module that owns it — restating it here
// as zod constraints is how reset drifted to accepting what sign-up refuses
// (over-72-byte passwords bcrypt silently truncates, all-whitespace ones).
const resetPasswordSchema = z
  .object({
    password: z.string().superRefine((value, ctx) => {
      const problem = passwordProblem(value);
      if (problem) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      }
    }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

/**
 * What a refusal MEANS for this screen, in a code the registry has words for.
 *
 * Not every refusal is a dead link, and that distinction is the whole of this
 * function. Telling somebody whose password was refused on policy — or who hit
 * the rate limit — that their LINK expired sends them to burn a fresh link and
 * meet the same wall. So only a refusal that is actually about the token gets
 * the dead-link treatment, and everything else keeps the form alive.
 *
 * The codes arrive already named: `/reset-password`'s refusals are translated
 * into our contract at the auth boundary (`server/better-auth/handled-errors.ts`),
 * so the payload better-auth's client hands back carries `identity_reset_link_invalid`
 * or `identity_password_rejected` and `readHandledError` lifts it off. The one
 * thing this screen adds is the rate limit, which is a status rather than a
 * code — the shape below is the flat one a REST boundary sends, which is what
 * the registry reads.
 *
 * Nothing here ever renders a message off the wire: since #5984 the wire
 * message for a handled refusal IS the code slug.
 */
function readResetRefusal(error: {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}): { error: unknown; linkIsDead: boolean; waitLine: string | null } {
  const handled = readHandledError(error);
  if (handled) {
    return {
      error,
      linkIsDead: handled.code === "identity_reset_link_invalid",
      waitLine: null,
    };
  }
  if (error.status === 429) {
    // The rate limiter is better-auth's and answers with no code of its own,
    // so there is nothing to name and nothing to key copy off. It is a state
    // of this SCREEN rather than a refusal we can classify — said in the
    // screen's own words, the way the log-in screen says the same thing.
    return {
      error: null,
      linkIsDead: false,
      waitLine: "Too many attempts. Wait a minute, then try again.",
    };
  }
  // An older or untranslated deployment: the token is still the only thing
  // whose refusal changes what this screen offers, and better-auth names it in
  // its own vocabulary. Read as a fallback, never rendered.
  const code = (error.code ?? "").toUpperCase();
  const linkIsDead = code.includes("TOKEN");
  return {
    error: linkIsDead ? { error: "identity_reset_link_invalid" } : error,
    linkIsDead,
    waitLine: null,
  };
}

/**
 * Setting the new password the emailed link authorises (D13, ADR-117 §6).
 *
 * The same card as every other auth-screen screen, on the same ground, morphing
 * between its states rather than replacing itself with a different-looking
 * page: this used to be the app's settings furniture — a bordered panel,
 * title-cased labels with helper lines, an orange button — and somebody who
 * has just failed to get in is the last person who should be wondering whether
 * they are still on the same site.
 *
 * What survives from before, unchanged, because it is the behaviour rather
 * than the paint: one password policy (`passwordProblem`, the module that owns
 * it), and a refusal that is honest about whether the LINK is the problem.
 */
export default function ResetPassword() {
  const query = useSearchParams();
  const token = query?.get("token") ?? null;

  const screen = token ? <ResetPasswordForm token={token} /> : <DeadLinkCard />;

  return <AuthShell>{screen}</AuthShell>;
}

/** The link carried no token at all: there is nothing here to spend. */
function DeadLinkCard() {
  usePublishAuthStage({ door: "signin", depth: "entry" });
  usePublishAuthStep({
    surface: AUTH_SURFACE.resetPassword,
    step: "link_dead",
  });

  return (
    <AuthCard
      title="That reset link didn't work"
      intro="Reset links can be opened once, and they expire an hour after they are sent."
    >
      <RequestNewLink />
      <BackToSignIn />
    </AuthCard>
  );
}

function ResetPasswordForm({ token }: { token: string }) {
  const form = useForm<z.infer<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    // Nothing is judged before submit; the auth screens' rule is that a
    // rejection is only ever an answer to something somebody wrote.
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [refusal, setRefusal] = useState<{
    error: unknown;
    linkIsDead: boolean;
    waitLine: string | null;
  } | null>(null);

  const report = useAuthAnalytics(AUTH_SURFACE.resetPassword);

  usePublishAuthStage({
    door: "signin",
    depth: isDone ? "settled" : "credential",
  });

  usePublishAuthStep({
    surface: AUTH_SURFACE.resetPassword,
    step: isDone ? "done" : "credential",
  });

  /**
   * Which of the two refusals this was, because they mean opposite things: a
   * dead link is somebody who waited too long, and anything else is a
   * password this screen would not take.
   */
  const announceRefusal = (error: Parameters<typeof readResetRefusal>[0]) => {
    const refused = readResetRefusal(error);
    setRefusal(refused);
    report.refused(
      refused.linkIsDead ? "link" : "password",
      refused.linkIsDead ? "identity_reset_link_invalid" : null,
    );
  };

  const onSubmit = async (values: z.infer<typeof resetPasswordSchema>) => {
    setIsLoading(true);
    setRefusal(null);
    try {
      const result = await authClient.resetPassword({
        newPassword: values.password,
        token,
      });
      if (result?.error) {
        announceRefusal(result.error);
        return;
      }
      setIsDone(true);
      report.submitted("password");
    } catch {
      // A throw is transport, not a verdict on the link. Nothing was named, so
      // nothing is claimed: the generic line and a trace id.
      setRefusal({
        error: new Error("reset request failed"),
        linkIsDead: false,
        waitLine: null,
      });
      report.refused("request", null);
    } finally {
      setIsLoading(false);
    }
  };

  if (isDone) return <PasswordUpdatedCard />;

  return (
    <AuthCard
      title="Choose a new password"
      intro="Type it twice so a slip cannot lock you out again."
    >
      <HandledErrorAlert
        error={refusal?.error}
        fallbackTitle="Couldn't reset your password"
        className="lw-auth-alert"
      />
      {/* The remedy for a dead link, and only for a dead link. Offered for a
          refused password it sends somebody to burn a fresh link and meet the
          same wall. */}
      {refusal?.linkIsDead ? <RequestNewLink /> : null}
      {refusal?.waitLine ? (
        <Text
          fontSize="13px"
          lineHeight="1.55"
          color="auth.danger"
          data-testid="reset-wait"
        >
          {refusal.waitLine}
        </Text>
      ) : null}
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <VStack width="full" align="stretch" gap="14px">
          <AuthField
            label="New password"
            error={form.formState.errors.password}
          >
            {(id) => (
              <PasswordInput
                id={id}
                autoComplete="new-password"
                registration={form.register("password")}
              />
            )}
          </AuthField>
          <AuthField
            label="Confirm password"
            error={form.formState.errors.confirmPassword}
          >
            {(id) => (
              <PasswordInput
                id={id}
                autoComplete="new-password"
                registration={form.register("confirmPassword")}
              />
            )}
          </AuthField>
          <VStack width="full" align="stretch" gap="14px" paddingTop="2px">
            <AuthPrimaryButton type="submit" isBusy={isLoading}>
              Reset password
            </AuthPrimaryButton>
            <BackToSignIn />
          </VStack>
        </VStack>
      </form>
    </AuthCard>
  );
}

/**
 * The offer's four states, and what each of them owes the person.
 *
 * State and callbacks, no JSX: the card below renders them.
 *
 * The ceremony starts on the CLICK and on nothing else. That is the same
 * real-gesture rule the sign-in screen's conditional offer obeys, and it is
 * the reason nothing here runs on mount: a system prompt opening over a
 * confirmation somebody came to read is an ambush, whatever it is offering.
 *
 * A prompt somebody opened and closed is a DECISION rather than a failure, so
 * it says nothing and leaves the offer exactly where it was. Only a refusal
 * that actually went wrong is reported, and it is reported as a code the
 * registry has words for — the wire message for a handled refusal IS the code
 * slug (#5984), so the raw one would put `identity_passkey_ceremony_failed` on
 * a screen somebody is trying to leave.
 */
function usePostResetPasskeyOffer() {
  const ceremony = usePasskeyCeremony();
  // This card's ceremony, not somebody else's: the store is module-scoped and
  // one surface at a time draws it.
  const registering = ceremony?.purpose === "register" ? ceremony : null;
  const [isDismissed, setIsDismissed] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const attempt = useRef<{ abandoned: boolean } | null>(null);

  const run = async (current: { abandoned: boolean }) => {
    try {
      const result = await authClient.passkey.addPasskey({});
      if (current.abandoned) return;
      if (result?.error) {
        // Status 0 is the system prompt closed by hand. Saying "something went
        // wrong" about a decision would be telling somebody off for deciding.
        if (result.error.status !== 0) {
          setFailure(passkeyFailureFrom(result.error));
        }
        return;
      }
      setIsAdded(true);
    } catch (error) {
      // A throw from the WebAuthn client: unsupported, an insecure origin, a
      // ceremony that never started. It never reached the server.
      if (!current.abandoned) setFailure(passkeyFailureFrom(error));
    } finally {
      // Cancelling already stood the panel down; ending it again from an
      // abandoned attempt would take down the one that replaced it.
      if (!current.abandoned) endPasskeyCeremony();
    }
  };

  const add = () => {
    setFailure(null);
    const current = { abandoned: false };
    attempt.current = current;
    startPasskeyCeremony({
      purpose: "register",
      cancel: () => {
        current.abandoned = true;
      },
      retry: add,
    });
    void run(current);
  };

  return {
    registering,
    isDismissed,
    isAdded,
    failure,
    add,
    dismiss: () => setIsDismissed(true),
  };
}

/**
 * The reset landed, and the reset SIGNED THEM IN: the link proved the
 * address and the password they just set is the credential, so there was
 * nothing left for the log-in screen to check. The card used to send them
 * there anyway, to type the address again and the password they had chosen
 * seconds earlier. Now the plain action is simply to continue.
 *
 * This is also one of the three moments ADR-120 names for offering a
 * passkey: they have just proved control of the address, they are thinking
 * about how they get in, and the most recent thing they learned is that the
 * password did not work. Being signed in, the offer is TAKEN here — the same
 * ceremony the settings page runs, on the screen somebody is already looking
 * at. It used to be a link to that page, which was a second button to find
 * and press for a thing they had already said yes to, and it existed only
 * because this screen had no session to run a ceremony with.
 *
 * It never stands in the way. Continuing is the plain, unmissable action and
 * is on the card in every one of the offer's states; the offer sits under it
 * and can be waved off, and waving it off leaves the card exactly as it would
 * have been.
 */
function PasswordUpdatedCard() {
  const offer = usePostResetPasskeyOffer();

  return (
    <AuthCard
      title="Password updated"
      intro="You are signed in with your new password. Every other device was signed out."
    >
      {/* At the top, like every other failure on these screens: an alert that
          opened under the offer would say its piece below the fold. */}
      <HandledErrorAlert
        error={offer.failure}
        fallbackTitle="That passkey wasn't created"
        className="lw-auth-alert"
      />
      {/* A link wearing the primary action, so it spreads the shared values
          rather than restating them. */}
      <Button {...AUTH_PRIMARY_STYLE} asChild>
        <Link href="/" data-testid="reset-sign-in">
          Continue
        </Link>
      </Button>
      <PostResetPasskeyOffer offer={offer} />
    </AuthCard>
  );
}

/** Whichever of the offer's states is current, under the way on. */
function PostResetPasskeyOffer({
  offer,
}: {
  offer: ReturnType<typeof usePostResetPasskeyOffer>;
}) {
  if (offer.registering) {
    return (
      <VStack width="full" align="stretch" gap="12px">
        {/* The panel carries no heading of its own — every surface that draws
            it names the state in its own furniture, and this card's one
            heading is already spoken for. */}
        <Text
          fontSize="14px"
          fontWeight={600}
          textAlign="center"
          data-testid="reset-passkey-ceremony-title"
        >
          {passkeyCeremonyTitle(offer.registering)}
        </Text>
        <PasskeyCeremonyPanel ceremony={offer.registering} />
      </VStack>
    );
  }

  if (offer.isAdded) {
    return (
      <VStack width="full" align="stretch" gap="6px">
        <Text
          fontSize="13.5px"
          fontWeight={600}
          data-testid="reset-passkey-added"
        >
          Passkey added
        </Text>
        <Text fontSize="13px" lineHeight="1.6" color="fg.muted">
          Next time you can sign in with your fingerprint, face or screen lock
          instead of typing a password.
        </Text>
      </VStack>
    );
  }

  if (offer.isDismissed) return null;

  return (
    <VStack
      width="full"
      align="stretch"
      gap="10px"
      data-testid="post-reset-passkey-offer"
    >
      <Text fontSize="13px" lineHeight="1.6" color="fg.muted">
        Next time, skip the password. A passkey uses the fingerprint, face or
        screen lock your device already has, and there is nothing to forget.
      </Text>
      <Button
        variant="outline"
        width="full"
        minHeight="42px"
        fontSize="13.5px"
        borderRadius={SHAPE.control}
        borderColor="auth.fieldBorder"
        onClick={offer.add}
        data-testid="reset-add-passkey"
      >
        Add a passkey
      </Button>
      <Button
        variant="plain"
        size="sm"
        alignSelf="center"
        fontSize="13px"
        color="fg.muted"
        onClick={offer.dismiss}
        data-testid="reset-dismiss-passkey"
      >
        Not now
      </Button>
    </VStack>
  );
}

function RequestNewLink() {
  return (
    <Text width="full" textAlign="center" fontSize="13px" color="fg.muted">
      <QuietLink href="/auth/forgot-password">
        Request a new reset link
      </QuietLink>
    </Text>
  );
}

function BackToSignIn() {
  return (
    <Text width="full" textAlign="center" fontSize="13px" color="fg.muted">
      <QuietLink href="/auth/signin">Back to sign in</QuietLink>
    </Text>
  );
}

/** The board's footer link: quiet, underlined, never a button. */
function QuietLink({ href, children }: { href: string; children: string }) {
  return (
    <Box
      asChild
      color="fg"
      fontWeight={600}
      textDecoration="underline"
      textUnderlineOffset="3px"
      textDecorationColor="border"
      _hover={{ textDecorationColor: "fg" }}
    >
      <Link href={href}>{children}</Link>
    </Box>
  );
}

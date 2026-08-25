import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { passwordProblem } from "@langwatch/identity";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthCard } from "~/components/auth/AuthCard";
import { AuthShell, useIdentityAuthScreens } from "~/features/auth";
import { SHAPE } from "~/features/auth/authTheme";
import { AuthField } from "~/features/auth/components/AuthField";
import {
  AUTH_PRIMARY_STYLE,
  AuthPrimaryButton,
} from "~/features/auth/components/AuthPrimaryButton";
import { PasswordInput } from "~/features/auth/components/PasswordInput";
import {
  useAuthAnalytics,
  usePublishAuthStep,
} from "~/features/auth/hooks/useAuthAnalytics";
import { useSignsInWithPasskeys } from "~/features/auth/hooks/useSignsInWithPasskeys";
import { AUTH_SURFACE } from "~/features/auth/logic/authAnalytics";
import { usePublishAuthStage } from "~/features/auth/logic/groundStage";
import { HandledErrorAlert } from "~/features/errors";
import { readHandledError } from "~/features/errors/logic/readHandledError";
import { authClient } from "~/utils/auth-client";
import Link from "~/utils/compat/next-link";
import { useSearchParams } from "~/utils/compat/next-navigation";

/** Where somebody goes to add a passkey once they are back in. */
const AUTHENTICATION_SETTINGS = "/settings/security";

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
  const auth = useIdentityAuthScreens();

  const screen = token ? <ResetPasswordForm token={token} /> : <DeadLinkCard />;

  // The shell is the auth screens' ground, so it appears where the auth screens
  // does and not before — the same condition `signin.tsx` composes on. The
  // CARD is the same either way: the grammar is not the flag's to decide.
  if (!auth.isResolved) return null;
  return auth.enabled ? <AuthShell>{screen}</AuthShell> : screen;
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

  const onSubmit = async (values: z.infer<typeof resetPasswordSchema>) => {
    setIsLoading(true);
    setRefusal(null);
    try {
      const result = await authClient.resetPassword({
        newPassword: values.password,
        token,
      });
      if (result?.error) {
        const refused = readResetRefusal(result.error);
        setRefusal(refused);
        // Which of the two refusals this was, because they mean opposite
        // things: a dead link is somebody who waited too long, and anything
        // else is a password this screen would not take.
        report.refused(
          refused.linkIsDead ? "link" : "password",
          refused.linkIsDead ? "identity_reset_link_invalid" : null,
        );
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
 * The reset landed — and this is one of the three moments ADR-120 names for
 * offering a passkey: they have just proved control of the address, they are
 * thinking about how they get in, and the most recent thing they learned is
 * that the password did not work.
 *
 * The offer takes them to the one place a passkey can actually be made. A
 * completed reset ends every session (`password-reset.feature`), so nobody is
 * signed in here and no ceremony could run on this card even if it wanted to
 * — which is also why the real-gesture rule is kept for free: nothing on this
 * screen opens a system prompt.
 *
 * It never stands in the way. Signing in is the plain, unmissable action;
 * the offer sits under it and can be waved off, and waving it off leaves the
 * card exactly as it would have been.
 */
function PasswordUpdatedCard() {
  const passkeys = useSignsInWithPasskeys();
  const [offerDismissed, setOfferDismissed] = useState(false);
  const offerPasskey = passkeys.enabled && !offerDismissed;

  return (
    <AuthCard
      title="Password updated"
      intro="You can sign in with your new password now. Every other device was signed out."
    >
      {/* A link wearing the primary action, so it spreads the shared values
          rather than restating them. */}
      <Button {...AUTH_PRIMARY_STYLE} asChild>
        <Link href="/auth/signin" data-testid="reset-sign-in">
          Sign in
        </Link>
      </Button>
      {offerPasskey ? (
        <VStack
          width="full"
          align="stretch"
          gap="10px"
          data-testid="post-reset-passkey-offer"
        >
          <Text fontSize="13px" lineHeight="1.6" color="fg.muted">
            Next time, skip the password. A passkey uses the fingerprint, face
            or screen lock your device already has, and there is nothing to
            forget.
          </Text>
          <Button
            asChild
            variant="outline"
            width="full"
            minHeight="42px"
            fontSize="13.5px"
            borderRadius={SHAPE.control}
            borderColor="auth.fieldBorder"
          >
            <Link
              href={`/auth/signin?callbackUrl=${encodeURIComponent(
                AUTHENTICATION_SETTINGS,
              )}`}
              data-testid="reset-add-passkey"
            >
              Sign in and add a passkey
            </Link>
          </Button>
          <Button
            variant="plain"
            size="sm"
            alignSelf="center"
            fontSize="13px"
            color="fg.muted"
            onClick={() => setOfferDismissed(true)}
            data-testid="reset-dismiss-passkey"
          >
            Not now
          </Button>
        </VStack>
      ) : null}
    </AuthCard>
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

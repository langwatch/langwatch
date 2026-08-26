import { Box, Input, Text, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthCard } from "~/components/auth/AuthCard";
import { AuthShell, useIdentityAuthScreens } from "~/features/auth";
import { SHAPE } from "~/features/auth/authTheme";
import {
  AuthField,
  FIELD_FOCUS,
  FIELD_SURFACE,
} from "~/features/auth/components/AuthField";
import { AuthPrimaryButton } from "~/features/auth/components/AuthPrimaryButton";
import { CheckYourEmail } from "~/features/auth/components/CheckYourEmail";
import {
  useAuthAnalytics,
  usePublishAuthStep,
} from "~/features/auth/hooks/useAuthAnalytics";
import { AUTH_SURFACE } from "~/features/auth/logic/authAnalytics";
import { usePublishAuthStage } from "~/features/auth/logic/groundStage";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { authClient } from "~/utils/auth-client";
import Link from "~/utils/compat/next-link";

const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, { message: "Enter your email address" })
    .email({ message: "That does not look like an email address" }),
});

/**
 * Asking for a reset link (D13, ADR-117 §6).
 *
 * The same card, ground and field grammar as the log-in screen it is one click
 * from. It used to be the app's settings furniture, which meant the one screen
 * somebody reaches when they are already frustrated was also the one that
 * looked like a different product.
 *
 * The behaviour it carries is older than the paint and unchanged by it: the
 * answer is the same whether or not the address has an account, and a
 * deployment that cannot send the link says so rather than promising one.
 */
export default function ForgotPassword() {
  const publicEnv = usePublicEnv();
  const auth = useIdentityAuthScreens();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;

  if (!publicEnv.data || !auth.isResolved) {
    return null;
  }

  // Reset follows the identifier, not the deployment (ADR-117 §6, epic Q9).
  // Whether a reset can happen is a fact about the account (does it hold a
  // password?), and the name of the deployment's sign-in provider is not that
  // fact. An installation that authenticates people itself keeps this door
  // open however it federates, which is what makes self-recovery reachable
  // for somebody whose identity provider is the thing that is broken.
  //
  // The one place the deployment still has the last word is where it holds no
  // passwords to reset at all: the reset endpoints are not mounted there, so
  // offering the form would promise an email nobody can send. That is the
  // method-set policy governing, not the mode, and it stops governing when
  // those installations hold password identifiers.
  //
  // Until the auth screens is enforced, the legacy rejection stands unchanged:
  // in SSO and social deployments the identity provider owns the password.
  const deploymentHoldsNoPasswords = auth.enabled
    ? Boolean(publicEnv.data.IS_SAAS) && isAuthProvider !== "email"
    : Boolean(isAuthProvider) && isAuthProvider !== "email";

  const screen = deploymentHoldsNoPasswords ? (
    <ManagedElsewhereCard>
      Your password is managed by your identity provider. Use your
      organization&apos;s single sign-on to reach LangWatch.
    </ManagedElsewhereCard>
  ) : // A self-hosted deployment with no mail transport cannot send the link
  // this form promises. Offering it anyway ends with "if an account exists we
  // have sent a link" and an inbox that never receives one, which reads as a
  // lost email rather than as a deployment that was never able to send it.
  !publicEnv.data.HAS_EMAIL_PROVIDER_KEY ? (
    <ManagedElsewhereCard>
      This deployment cannot send email, so it cannot send you a reset link. Ask
      whoever operates it to reset your password for you, or to configure an
      email provider.
    </ManagedElsewhereCard>
  ) : (
    <ForgotPasswordForm />
  );

  // The shell is the auth screens' ground, so it appears where the auth screens
  // does — the same condition `signin.tsx` composes on. The CARD is the same
  // either way: the grammar is not the flag's to decide.
  return auth.enabled ? <AuthShell>{screen}</AuthShell> : screen;
}

/** Nothing to do here, and the honest reason why. */
function ManagedElsewhereCard({ children }: { children: ReactNode }) {
  usePublishAuthStage({ door: "signin", depth: "entry" });

  return (
    <AuthCard title="Forgot your password?">
      <Text fontSize="13.5px" lineHeight="1.65" color="fg.muted">
        {children}
      </Text>
      <BackToSignIn />
    </AuthCard>
  );
}

function ForgotPasswordForm() {
  const form = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const report = useAuthAnalytics(AUTH_SURFACE.forgotPassword);

  usePublishAuthStage({
    door: "signin",
    depth: submittedEmail ? "sent" : "entry",
  });

  // Two steps, and the gap between them is the number worth having: how many
  // people who reach this screen actually ask for a link.
  usePublishAuthStep({
    surface: AUTH_SURFACE.forgotPassword,
    step: submittedEmail ? "sent" : "address",
  });

  const onSubmit = async (values: z.infer<typeof forgotPasswordSchema>) => {
    setIsLoading(true);
    try {
      // BetterAuth returns a success-shaped response whether or not the email
      // is registered, and we swallow any transport error below: the form must
      // never reveal which addresses have an account.
      await authClient.requestPasswordReset({
        email: values.email,
        redirectTo: "/auth/reset-password",
      });
    } catch {
      // Intentionally ignored. See the neutral-confirmation note above.
    } finally {
      setIsLoading(false);
      setSubmittedEmail(values.email);
      // Reported the same way whatever happened, for the same reason the
      // SCREEN says the same thing whatever happened: this door must never
      // reveal which addresses have an account, and an analytics event that
      // fired only on the real ones would say it just as loudly to anybody
      // who can read the network tab.
      report.submitted("address");
      report.linkSent("password_reset");
    }
  };

  if (submittedEmail) {
    return (
      // The same card the other doors end at, said with the one hedge this
      // door owes: whether a link went out is not ours to confirm.
      <CheckYourEmail
        email={submittedEmail}
        uncertain
        what="Open it to choose a new password."
        onUseDifferentEmail={() => setSubmittedEmail(null)}
      />
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      intro="Give us the address on your account and we will send a link to set a new password."
    >
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <VStack width="full" align="stretch" gap="14px">
          <AuthField label="Email" error={form.formState.errors.email}>
            {(id) => (
              <Input
                id={id}
                type="email"
                placeholder="you@company.com"
                // 16px on a phone: anything smaller makes iOS zoom the page in
                // when the field takes focus, and it never zooms back out.
                fontSize={{ base: "16px", md: "14px" }}
                minHeight="44px"
                borderRadius={SHAPE.field}
                autoComplete="username"
                {...FIELD_SURFACE}
                _focusVisible={FIELD_FOCUS}
                {...form.register("email")}
              />
            )}
          </AuthField>
          <VStack width="full" align="stretch" gap="14px" paddingTop="2px">
            <AuthPrimaryButton type="submit" isBusy={isLoading}>
              Send reset link
            </AuthPrimaryButton>
            <BackToSignIn />
          </VStack>
        </VStack>
      </form>
    </AuthCard>
  );
}

function BackToSignIn() {
  return (
    <Text width="full" textAlign="center" fontSize="13px" color="fg.muted">
      <Box
        asChild
        color="fg"
        fontWeight={600}
        textDecoration="underline"
        textUnderlineOffset="3px"
        textDecorationColor="border"
        _hover={{ textDecorationColor: "fg" }}
      >
        <Link href="/auth/signin">Back to sign in</Link>
      </Box>
    </Text>
  );
}

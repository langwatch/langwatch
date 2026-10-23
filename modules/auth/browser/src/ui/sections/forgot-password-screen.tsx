import { zodResolver } from "@hookform/resolvers/zod";
import { Input, Text, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { authClient } from "../../behavior/auth-client.tsx";
import { usePublicEnv } from "../../behavior/use-public-env.ts";
import {
  forgetCarriedEmail,
  readCarriedEmail,
  readCarriedResetRequirement,
} from "../../model/carried-email.ts";
import { AuthCard } from "../../ui/elements/auth-card.tsx";
import { CheckYourEmail } from "../../ui/elements/check-your-email.tsx";
import { FIELD_FOCUS, FIELD_SURFACE, FrontDoorField } from "../../ui/elements/front-door-field.tsx";
import { FrontDoorLinkButton } from "../../ui/elements/front-door-link-button.tsx";
import { FrontDoorPrimaryButton } from "../elements/front-door-primary-button.tsx";
import { FrontDoorShell } from "./front-door-shell.tsx";

const forgotPasswordSchema = z.object({ email: z.string().email() });

export default function ForgotPassword() {
  return (
    <FrontDoorShell>
      <ForgotPasswordScreen />
    </FrontDoorShell>
  );
}

function ForgotPasswordScreen() {
  const publicEnv = usePublicEnv();
  // The sign-in step hands over the address just typed, in the fragment, read at first paint.
  const [carriedEmail] = useState(readCarriedEmail);
  const [resetRequired] = useState(readCarriedResetRequirement);

  if (!publicEnv.data) {
    return null;
  }

  if (!publicEnv.data.EMAIL_PASSWORD_ENABLED) {
    return (
      <AuthCard title="Forgot your password?">
        <Text>
          Your password is managed by your identity provider. Use your organization single sign-on
          to access LangWatch.
        </Text>
        <BackToSignInLink />
      </AuthCard>
    );
  }

  // Without mail the form would promise a link nobody can send. The screen
  // does not say why; it says who can help (ARCHITECTURE.md §6, mail off).
  if (!publicEnv.data.HAS_EMAIL_PROVIDER_KEY) {
    return (
      <AuthCard title={resetRequired ? "Choose a new password" : "Forgot your password?"}>
        <Text>
          {resetRequired
            ? "You need to set a new password before you can sign in, and password reset by email is not available."
            : "Password reset by email is not available."}{" "}
          {publicEnv.data.IS_SAAS
            ? "Contact LangWatch support to get back into your account."
            : "Contact your administrator to get back into your account."}
        </Text>
        <BackToSignInLink />
      </AuthCard>
    );
  }

  return <ForgotPasswordForm carriedEmail={carriedEmail} resetRequired={resetRequired} />;
}

function ForgotPasswordForm({
  carriedEmail,
  resetRequired,
}: {
  carriedEmail: string | undefined;
  resetRequired: boolean;
}) {
  // Only the form takes the address back out of the address bar, having prefilled it.
  useEffect(forgetCarriedEmail, []);
  const form = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: carriedEmail ?? "" },
  });
  const [isLoading, setIsLoading] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

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
      return;
    } finally {
      setIsLoading(false);
      setSubmittedEmail(values.email);
    }
  };

  // The same check-your-email every other door shows, in the same card: the
  // content changes, the surface does not. And it is not a dead end — the
  // commonest reason to be staring at this card puzzled is that the address
  // on it is wrong.
  if (submittedEmail) {
    return (
      <CheckYourEmail
        email={submittedEmail}
        what="If an account exists for it, opening the link lets you choose a new password."
        onUseDifferentEmail={() => setSubmittedEmail(null)}
      />
    );
  }

  return (
    <AuthCard
      title={resetRequired ? "Choose a new password" : "Forgot your password?"}
      intro={
        resetRequired
          ? "You need to set a new password before you can sign in. We will email you a link to choose one."
          : "Enter the email for your account and we will send you a link to reset your password."
      }
    >
      <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <VStack width="full" align="stretch" gap="3.5">
          <FrontDoorField label="Email" error={form.formState.errors.email}>
            {(id) => (
              <Input
                id={id}
                type="email"
                placeholder="you@company.com"
                // 16px on a phone: anything smaller makes iOS zoom the page in
                // when the field takes focus, and it never zooms back out.
                fontSize={{ base: "md", md: "sm" }}
                minHeight="44px"
                autoComplete="username"
                {...FIELD_SURFACE}
                _focusVisible={FIELD_FOCUS}
                {...form.register("email")}
              />
            )}
          </FrontDoorField>
          <FrontDoorPrimaryButton type="submit" isBusy={isLoading}>
            Send reset link
          </FrontDoorPrimaryButton>
          <BackToSignInLink />
        </VStack>
      </form>
    </AuthCard>
  );
}

function BackToSignInLink() {
  return <FrontDoorLinkButton href="/auth/signin" label="Back to sign in" tone="secondary" />;
}

import { Box, Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useIdentityFrontDoor } from "../../behavior/use-identity-front-door.ts";
import { authClient } from "../../behavior/auth-client.tsx";
import Link from "../../ui/elements/router-link.tsx";
import { AuthCard } from "../../ui/elements/auth-card.tsx";
import { CheckYourEmail } from "../../ui/elements/check-your-email.tsx";
import { FIELD_FOCUS, FIELD_SURFACE, FrontDoorField } from "../../ui/elements/front-door-field.tsx";
import { usePublicEnv } from "../../behavior/use-public-env.ts";

const forgotPasswordSchema = z.object({ email: z.string().email() });

export default function ForgotPassword() {
  const publicEnv = usePublicEnv();
  const frontDoor = useIdentityFrontDoor();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;

  if (!publicEnv.data) {
    return null;
  }

  // Reset follows account (has password?), not deployment provider.
  const deploymentHoldsNoPasswords = frontDoor.enabled
    ? Boolean(publicEnv.data.IS_SAAS) && isAuthProvider !== "email"
    : Boolean(isAuthProvider) && isAuthProvider !== "email";

  if (deploymentHoldsNoPasswords) {
    return (
      <AuthCard title="Forgot password">
        <Text>
          Your password is managed by your identity provider. Use your organization single sign-on
          to access LangWatch.
        </Text>
        <BackToSignInLink />
      </AuthCard>
    );
  }

  // A self-hosted deployment with no mail transport cannot send the link this
  // form promises. Offering it anyway ends with "if an account exists we have
  // sent a link" and an inbox that never receives one, which reads as a lost
  // email rather than as a deployment that was never able to send it.
  if (!publicEnv.data.HAS_EMAIL_PROVIDER_KEY) {
    return (
      <AuthCard title="Forgot password">
        <Text>
          This deployment cannot send email, so it cannot send you a reset link. Ask whoever
          operates it to reset your password for you, or to configure an email provider.
        </Text>
        <BackToSignInLink />
      </AuthCard>
    );
  }

  return <ForgotPasswordForm />;
}

function ForgotPasswordForm() {
  const form = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
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
    <AuthCard title="Forgot password">
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <VStack width="full" align="stretch" gap="14px">
          <Text color="fg.muted" fontSize="13.5px" lineHeight="1.65">
            Enter the email for your account and we will send you a link to reset your password.
          </Text>
          <FrontDoorField label="Email" error={form.formState.errors.email}>
            {(id) => (
              <Input
                id={id}
                type="email"
                placeholder="you@company.com"
                // 16px on a phone: anything smaller makes iOS zoom the page in
                // when the field takes focus, and it never zooms back out.
                fontSize={{ base: "16px", md: "14px" }}
                minHeight="44px"
                autoComplete="username"
                {...FIELD_SURFACE}
                _focusVisible={FIELD_FOCUS}
                {...form.register("email")}
              />
            )}
          </FrontDoorField>
          <Button
            className="lw-front-door-primary"
            type="submit"
            width="full"
            minHeight="44px"
            fontSize="14px"
            fontWeight={600}
            backgroundColor="frontDoor.action"
            color="frontDoor.onAction"
            _hover={{ backgroundColor: "frontDoor.actionHover" }}
            loading={isLoading}
          >
            Send reset link
          </Button>
          <HStack width="full" justify="center">
            <BackToSignInLink />
          </HStack>
        </VStack>
      </form>
    </AuthCard>
  );
}

function BackToSignInLink() {
  return (
    <Box asChild>
      <Link href="/auth/signin" style={{ textDecoration: "underline" }}>
        Back to sign in
      </Link>
    </Box>
  );
}

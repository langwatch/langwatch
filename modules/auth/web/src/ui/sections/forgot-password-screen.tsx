import {
  Box,
  Button,
  Card,
  Container,
  Heading,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useIdentityFrontDoor } from "../../behavior/use-identity-front-door.ts";
import { authClient } from "../../behavior/auth-client.tsx";
import Link from "../../ui/elements/router-link.tsx";
import { AuthCard } from "../../ui/elements/auth-card.tsx";
import { HorizontalFormControl } from "../../ui/elements/horizontal-form-control.tsx";
import { LogoIcon } from "../../ui/elements/logo-icon.tsx";
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
    } finally {
      setIsLoading(false);
      setSubmittedEmail(values.email);
    }
  };

  if (submittedEmail) {
    return (
      <AuthCard title="Check your email">
        <Text>
          If an account exists for <b>{submittedEmail}</b>, we have sent a link to reset your
          password. The link expires in 1 hour.
        </Text>
        <BackToSignInLink />
      </AuthCard>
    );
  }

  return (
    <Container maxW="container.md" paddingTop="calc(40vh - 164px)">
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card.Root>
          <Card.Header>
            <HStack gap={4}>
              <LogoIcon width={30.69} height={42} />
              <Heading size="lg" as="h1">
                Forgot password
              </Heading>
            </HStack>
          </Card.Header>
          <Card.Body>
            <VStack width="full">
              <Text width="full" color="gray.600">
                Enter the email for your account and we will send you a link to reset your password.
              </Text>
              <HorizontalFormControl
                label="Email"
                helper="Enter your email"
                invalid={form.formState.errors.email?.message !== undefined}
              >
                <Input type="email" {...form.register("email")} />
              </HorizontalFormControl>
              <HStack width="full" paddingTop={4}>
                <BackToSignInLink />
                <Spacer />
                <Button colorPalette="orange" type="submit" loading={isLoading}>
                  Send reset link
                </Button>
              </HStack>
            </VStack>
          </Card.Body>
        </Card.Root>
      </form>
    </Container>
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

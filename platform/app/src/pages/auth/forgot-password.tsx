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
import { useIdentityFrontDoor } from "~/features/auth-front-door";
import { authClient } from "~/utils/auth-client";
import Link from "~/utils/compat/next-link";
import { AuthCard } from "../../components/auth/AuthCard";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { usePublicEnv } from "../../hooks/usePublicEnv";

const forgotPasswordSchema = z.object({ email: z.string().email() });

export default function ForgotPassword() {
  const publicEnv = usePublicEnv({ includeCapabilities: true });
  const frontDoor = useIdentityFrontDoor();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;

  if (!publicEnv.data) {
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
  // Until the front door is enforced, the legacy rejection stands unchanged:
  // in SSO and social deployments the identity provider owns the password.
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

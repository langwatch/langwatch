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
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "~/utils/auth-client";
import Link from "~/utils/compat/next-link";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { usePublicEnv } from "../../hooks/usePublicEnv";

const forgotPasswordSchema = z.object({ email: z.string().email() });

export default function ForgotPassword() {
  const publicEnv = usePublicEnv();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;

  if (!publicEnv.data) {
    return null;
  }

  // Reset is a credential-mode concept. In SSO / social deployments the
  // identity provider owns the password, so point the user back to sign in
  // instead of a form that would only no-op against the blocked endpoint.
  if (isAuthProvider && isAuthProvider !== "email") {
    return (
      <AuthCard title="Forgot password">
        <Text>
          Your password is managed by your identity provider. Use your
          organization single sign-on to access LangWatch.
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
          If an account exists for <b>{submittedEmail}</b>, we have sent a link
          to reset your password. The link expires in 1 hour.
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
                Enter the email for your account and we will send you a link to
                reset your password.
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

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Container maxW="container.md" paddingTop="calc(40vh - 164px)">
      <Card.Root>
        <Card.Header>
          <HStack gap={4}>
            <LogoIcon width={30.69} height={42} />
            <Heading size="lg" as="h1">
              {title}
            </Heading>
          </HStack>
        </Card.Header>
        <Card.Body>
          <VStack width="full" align="start" gap={4}>
            {children}
          </VStack>
        </Card.Body>
      </Card.Root>
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

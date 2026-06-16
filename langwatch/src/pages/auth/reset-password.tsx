import {
  Alert,
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
import { useSearchParams } from "~/utils/compat/next-navigation";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import { LogoIcon } from "../../components/icons/LogoIcon";

const INVALID_LINK_MESSAGE =
  "This password reset link is invalid or has expired. Request a new one to continue.";

export default function ResetPassword() {
  const query = useSearchParams();
  const token = query?.get("token") ?? null;

  if (!token) {
    return (
      <AuthCard title="Invalid reset link">
        <Text>{INVALID_LINK_MESSAGE}</Text>
        <RequestNewLink />
      </AuthCard>
    );
  }

  return <ResetPasswordForm token={token} />;
}

function ResetPasswordForm({ token }: { token: string }) {
  const schema = z
    .object({
      password: z
        .string()
        .min(8, { message: "Password must be at least 8 characters" }),
      confirmPassword: z
        .string()
        .min(8, { message: "Password must be at least 8 characters" }),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: "Passwords don't match",
      path: ["confirmPassword"],
    });

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setIsLoading(true);
    setServerError(null);
    try {
      const result = await authClient.resetPassword({
        newPassword: values.password,
        token,
      });
      if (result?.error) {
        setServerError(INVALID_LINK_MESSAGE);
        return;
      }
      setIsDone(true);
    } catch {
      setServerError(INVALID_LINK_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  };

  if (isDone) {
    return (
      <AuthCard title="Password updated">
        <Text>
          Your password has been reset. You can now sign in with your new
          password.
        </Text>
        <Button colorPalette="orange" asChild>
          <Link href="/auth/signin">Sign in</Link>
        </Button>
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
                Reset password
              </Heading>
            </HStack>
          </Card.Header>
          <Card.Body>
            <VStack width="full">
              <HorizontalFormControl
                label="New Password"
                helper="Enter your new password"
                invalid={form.formState.errors.password?.message !== undefined}
                error={form.formState.errors.password}
              >
                <Input type="password" {...form.register("password")} />
              </HorizontalFormControl>
              <HorizontalFormControl
                label="Confirm Password"
                helper="Confirm your new password"
                invalid={
                  form.formState.errors.confirmPassword?.message !== undefined
                }
                error={form.formState.errors.confirmPassword}
              >
                <Input type="password" {...form.register("confirmPassword")} />
              </HorizontalFormControl>
              {serverError && (
                <Alert.Root status="error" width="full">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{serverError}</Alert.Description>
                    <RequestNewLink />
                  </Alert.Content>
                </Alert.Root>
              )}
              <HStack width="full" paddingTop={4}>
                <Box asChild>
                  <Link
                    href="/auth/signin"
                    style={{ textDecoration: "underline" }}
                  >
                    Back to sign in
                  </Link>
                </Box>
                <Spacer />
                <Button colorPalette="orange" type="submit" loading={isLoading}>
                  Reset password
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

function RequestNewLink() {
  return (
    <Box asChild>
      <Link
        href="/auth/forgot-password"
        style={{ textDecoration: "underline" }}
      >
        Request a new reset link
      </Link>
    </Box>
  );
}

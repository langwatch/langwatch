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
import { passwordProblem } from "@langwatch/identity";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "~/utils/auth-client";
import Link from "~/utils/compat/next-link";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { AuthCard } from "../../components/auth/AuthCard";
import { FormErrorDisplay } from "../../components/FormErrorDisplay";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import { LogoIcon } from "../../components/icons/LogoIcon";

const INVALID_LINK_MESSAGE =
  "This password reset link is invalid or has expired. Request a new one to continue.";

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
 * Not every refusal is a dead link. Telling somebody whose password was
 * refused on policy — or who hit the rate limit — that their LINK expired
 * sends them to burn a fresh link and meet the same wall. Only an error that
 * is actually about the token gets the dead-link copy; everything else keeps
 * the form alive and says what happened.
 */
function describeResetRefusal(error: {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}): { message: string; linkIsDead: boolean } {
  const code = (error.code ?? "").toUpperCase();
  const message = (error.message ?? "").toLowerCase();
  if (code.includes("TOKEN") || message.includes("token")) {
    return { message: INVALID_LINK_MESSAGE, linkIsDead: true };
  }
  if (error.status === 429) {
    return {
      message: "Too many attempts. Wait a minute, then try again.",
      linkIsDead: false,
    };
  }
  if (code.includes("PASSWORD") || message.includes("password")) {
    return {
      message: "That password was not accepted. Choose a different one.",
      linkIsDead: false,
    };
  }
  return {
    message: "Could not reset your password. Try again.",
    linkIsDead: false,
  };
}

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
  const form = useForm<z.infer<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [serverError, setServerError] = useState<{
    message: string;
    linkIsDead: boolean;
  } | null>(null);

  const onSubmit = async (values: z.infer<typeof resetPasswordSchema>) => {
    setIsLoading(true);
    setServerError(null);
    try {
      const result = await authClient.resetPassword({
        newPassword: values.password,
        token,
      });
      if (result?.error) {
        setServerError(describeResetRefusal(result.error));
        return;
      }
      setIsDone(true);
    } catch {
      // A throw is transport, not a verdict on the link.
      setServerError({
        message:
          "Could not reach the server. Check your connection and try again.",
        linkIsDead: false,
      });
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
        <Button colorPalette="orange" variant="solid" asChild>
          <Link href="/auth/signin" style={{ color: "white" }}>
            Sign in
          </Link>
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
              >
                <VStack align="stretch" gap={1} width="full">
                  <Input type="password" {...form.register("password")} />
                  <FormErrorDisplay error={form.formState.errors.password} />
                </VStack>
              </HorizontalFormControl>
              <HorizontalFormControl
                label="Confirm Password"
                helper="Confirm your new password"
                invalid={
                  form.formState.errors.confirmPassword?.message !== undefined
                }
              >
                <VStack align="stretch" gap={1} width="full">
                  <Input
                    type="password"
                    {...form.register("confirmPassword")}
                  />
                  <FormErrorDisplay
                    error={form.formState.errors.confirmPassword}
                  />
                </VStack>
              </HorizontalFormControl>
              {serverError && (
                <Alert.Root status="error" width="full">
                  <Alert.Indicator />
                  <Alert.Content>
                    {/* Not an error's own message. `serverError` is a local
                        shape whose `message` is always copy this file wrote:
                        every branch of `describeResetRefusal` returns a
                        hand-written string, and the transport catch does too.
                        Nothing from the server reaches the reader. The marker
                        sits on the line itself because the guard reads the
                        slot's own lines, not the comment above them. */}
                    <Alert.Description>{/* no-raw-error-toast-ok */ serverError.message}</Alert.Description>
                    {/* A new link is the remedy only when the link is the
                        problem — offered for a refused password, it sends
                        somebody to burn a fresh link and meet the same wall. */}
                    {serverError.linkIsDead ? <RequestNewLink /> : null}
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

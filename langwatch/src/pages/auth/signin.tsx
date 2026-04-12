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
import type { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getServerAuthSession, type Session } from "~/server/auth";
import { signIn } from "~/utils/auth-client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { toaster } from "../../components/ui/toaster";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { SignInError } from "./error";

export default function SignIn({ session }: { session: Session | null }) {
  const query = useSearchParams();
  const error = query?.get("error");
  const loggedOut = query?.get("logged_out") === "true";

  const publicEnv = usePublicEnv();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;
  const callbackUrl = query?.get("callbackUrl") ?? undefined;

  const isSocialProvider =
    isAuthProvider && isAuthProvider !== "email";

  useEffect(() => {
    if (!publicEnv.data) return;
    if (loggedOut) return;

    if (
      error !== "OAuthAccountNotLinked" &&
      !session &&
      isSocialProvider
    ) {
      setTimeout(
        () => {
          void signIn(isAuthProvider, { callbackUrl });
        },
        error ? 2000 : 0,
      );
    }
  }, [publicEnv.data, session, callbackUrl, isAuthProvider, isSocialProvider, error, loggedOut]);

  if (error) {
    return <SignInError error={error} />;
  }

  if (!publicEnv.data) {
    return null;
  }

  if (isSocialProvider && loggedOut) {
    return (
      <Container maxW="container.md" paddingTop="calc(40vh - 164px)">
        <Card.Root>
          <Card.Header>
            <HStack gap={4}>
              <LogoIcon width={30.69} height={42} />
              <Heading size="lg" as="h1">
                Signed out
              </Heading>
            </HStack>
          </Card.Header>
          <Card.Body>
            <VStack width="full" gap={4}>
              <Text>You have been signed out successfully.</Text>
              <Button
                colorPalette="orange"
                onClick={() => void signIn(isAuthProvider, { callbackUrl })}
              >
                Sign in again
              </Button>
            </VStack>
          </Card.Body>
        </Card.Root>
      </Container>
    );
  }

  if (isSocialProvider) {
    return <Box padding="12px">Redirecting to Sign in...</Box>;
  }

  return <SignInForm />;
}

export const getServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const session = await getServerAuthSession({ req: context.req });

  if (session) {
    return {
      redirect: {
        destination: "/",
        permanent: false,
      },
    };
  }

  return {
    props: { session },
  };
};

function SignInForm() {
  const query = useSearchParams();
  const error = query?.get("error");
  const callbackUrl = query?.get("callbackUrl") ?? undefined;

  const schema = z.object({
    email: z.string().email(),
    password: z.string(),
  });

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });

  const [signInLoading, setSignInLoading] = useState(false);

  const onSubmit = async (values: z.infer<typeof schema>) => {
    try {
      setSignInLoading(true);
      const response = await signIn("credentials", {
        email: values.email,
        password: values.password,
        callbackUrl: callbackUrl,
      });
      setSignInLoading(false);

      if (response?.error) {
        throw new Error("Sign in failed");
      }

      if (response?.status && response.status >= 400) {
        throw new Error("Network response was not ok");
      }
    } catch {
      toaster.create({
        title: "Error",
        description: "Failed to sign in",
        type: "error",
        meta: {
          closable: true,
        },
      });
    }
  };

  return (
    <Container maxW="container.md" paddingTop="calc(40vh - 164px)">
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card.Root>
          <Card.Header>
            <HStack gap={4}>
              <LogoIcon width={30.69} height={42} />
              <Heading size="lg" as="h1">
                Sign in
              </Heading>
            </HStack>
          </Card.Header>
          <Card.Body>
            <VStack width="full">
              <HorizontalFormControl
                label="Email"
                helper="Enter your email"
                invalid={form.formState.errors.email?.message !== undefined}
              >
                <Input type="email" {...form.register("email")} />
              </HorizontalFormControl>
              <HorizontalFormControl
                label="Password"
                helper="Enter your password"
                invalid={form.formState.errors.password?.message !== undefined}
              >
                <Input type="password" {...form.register("password")} />
              </HorizontalFormControl>
              {error && (
                <Alert.Root status="error">
                  <Alert.Indicator />
                  <Alert.Content>
                    {error === "CredentialsSignin"
                      ? "Invalid email or password"
                      : error}
                  </Alert.Content>
                </Alert.Root>
              )}
              <HStack width="full" paddingTop={4}>
                <Box asChild>
                  <Link
                    href={`/auth/signup${
                      callbackUrl
                        ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
                        : ""
                    }`}
                    style={{ textDecoration: "underline" }}
                  >
                    Register new account
                  </Link>
                </Box>
                <Spacer />
                <Button
                  colorPalette="orange"
                  type="submit"
                  loading={signInLoading}
                >
                  Sign in
                </Button>
              </HStack>
            </VStack>
          </Card.Body>
        </Card.Root>
      </form>
    </Container>
  );
}

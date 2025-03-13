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
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { type GetServerSidePropsContext } from "next";
import { type Session } from "next-auth";
import { getSession, signIn } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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

  const publicEnv = usePublicEnv();
  const isAuth0 = publicEnv.data?.NEXTAUTH_PROVIDER === "auth0";
  const callbackUrl = useSearchParams()?.get("callbackUrl") ?? undefined;

  useEffect(() => {
    if (!publicEnv.data) {
      return;
    }

    if (error !== "OAuthAccountNotLinked" && !session && isAuth0) {
      setTimeout(
        () => {
          void signIn("auth0", { callbackUrl });
        },
        error ? 2000 : 0
      );
    }
  }, [publicEnv.data, session, callbackUrl, isAuth0, error]);

  if (error) {
    return <SignInError error={error} />;
  }

  if (!publicEnv.data) {
    return null;
  }

  return isAuth0 ? (
    <Box padding="12px">Redirecting to Sign in...</Box>
  ) : (
    <SignInForm />
  );
}

export const getServerSideProps = async (
  context: GetServerSidePropsContext
) => {
  const session = await getSession(context);

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
      const response: any = await signIn("credentials", {
        email: values.email,
        password: values.password,
      });
      setSignInLoading(false);

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
    } catch (e) {
      toaster.create({
        title: "Error",
        description: "Failed to sign up",
        type: "error",
        placement: "top-end",
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
                    href="/auth/signup"
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

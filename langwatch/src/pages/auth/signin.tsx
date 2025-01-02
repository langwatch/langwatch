import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Container,
  HStack,
  Heading,
  Input,
  Spacer,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { Link } from "@chakra-ui/next-js";
import { zodResolver } from "@hookform/resolvers/zod";
import { type GetServerSidePropsContext } from "next";
import { type Session } from "next-auth";
import { getSession, signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { usePublicEnv } from "../../hooks/usePublicEnv";

export default function SignIn({ session }: { session: Session | null }) {
  const publicEnv = usePublicEnv();
  const isAuth0 = publicEnv.data?.NEXTAUTH_PROVIDER === "auth0";
  const callbackUrl = useSearchParams()?.get("callbackUrl") ?? undefined;

  useEffect(() => {
    if (!publicEnv.data) {
      return;
    }

    if (!session && isAuth0) {
      void signIn("auth0", { callbackUrl });
    }
  }, [publicEnv.data, session, callbackUrl, isAuth0]);

  if (!publicEnv.data) {
    return null;
  }

  return isAuth0 ? (
    <div style={{ padding: "12px" }}>Redirecting to Sign in...</div>
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
  const toast = useToast();

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
      toast({
        title: "Error",
        description: "Failed to sign up",
        status: "error",
        duration: 5000,
      });
    }
  };

  return (
    <Container maxW="container.md" marginTop="calc(40vh - 164px)">
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <HStack spacing={4}>
              <LogoIcon width={30.69} height={42} />
              <Heading size="lg" as="h1">
                Sign in
              </Heading>
            </HStack>
          </CardHeader>
          <CardBody>
            <VStack width="full">
              <HorizontalFormControl
                label="Email"
                helper="Enter your email"
                isInvalid={form.formState.errors.email?.message !== undefined}
              >
                <Input type="email" {...form.register("email")} />
              </HorizontalFormControl>
              <HorizontalFormControl
                label="Password"
                helper="Enter your password"
                isInvalid={
                  form.formState.errors.password?.message !== undefined
                }
              >
                <Input type="password" {...form.register("password")} />
              </HorizontalFormControl>
              {error && (
                <Alert status="error">
                  {error === "CredentialsSignin"
                    ? "Invalid email or password"
                    : error}
                </Alert>
              )}
              <HStack width="full" paddingTop={4}>
                <Link href="/auth/signup" textDecoration="underline">
                  Register new account
                </Link>
                <Spacer />
                <Button
                  colorScheme="orange"
                  type="submit"
                  isLoading={signInLoading}
                >
                  Sign in
                </Button>
              </HStack>
            </VStack>
          </CardBody>
        </Card>
      </form>
    </Container>
  );
}

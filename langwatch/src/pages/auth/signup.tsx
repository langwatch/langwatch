import {
  Alert,
  Button,
  Card,
  Container,
  HStack,
  Heading,
  Input,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { Link } from "../../components/ui/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { type Session } from "next-auth";
import { getSession, signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { LogoIcon } from "../../components/icons/LogoIcon";
import type { GetServerSidePropsContext } from "next";
import { api } from "../../utils/api";
import { toaster } from "../../components/ui/toaster";

export default function SignUp({ session }: { session: Session | null }) {
  const publicEnv = usePublicEnv();
  const isAuth0 = publicEnv.data?.NEXTAUTH_PROVIDER === "auth0";
  const isAzureAD = publicEnv.data?.NEXTAUTH_PROVIDER === "azure-ad";
  const callbackUrl = useSearchParams()?.get("callbackUrl") ?? undefined;

  useEffect(() => {
    if (!publicEnv.data) {
      return;
    }

    if (!session && isAuth0) {
      void signIn("auth0", { callbackUrl });
    }

    if (!session && isAzureAD) {
      void signIn("azure-ad", { callbackUrl });
    }
  }, [publicEnv.data, session, callbackUrl, isAuth0, isAzureAD]);

  if (!publicEnv.data) {
    return null;
  }

  return isAuth0 ? (
    <div style={{ padding: "12px" }}>Redirecting to Sign in...</div>
  ) : (
    <SignUpForm />
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

function SignUpForm() {
  const schema = z
    .object({
      name: z.string().min(1, { message: "Name is required" }),
      email: z.string().min(1).email(),
      password: z
        .string()
        .min(6, { message: "Password must be at least 6 characters" }),
      confirmPassword: z
        .string()
        .min(6, { message: "Password must be at least 6 characters" }),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: "Passwords don't match",
      path: ["confirmPassword"], // Set the path of the error to confirmPassword field
    });

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });

  const register = api.user.register.useMutation();
  const [signInLoading, setSignInLoading] = useState(false);

  const onSubmit = async (values: z.infer<typeof schema>) => {
    try {
      await register.mutateAsync(values);

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
                Sign up
              </Heading>
            </HStack>
          </Card.Header>
          <Card.Body>
            <VStack width="full">
              <HorizontalFormControl
                label="Name"
                helper="Enter your name"
                invalid={form.formState.errors.name?.message !== undefined}
              >
                <Input {...form.register("name")} />
              </HorizontalFormControl>
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
              <HorizontalFormControl
                label="Confirm Password"
                helper="Confirm your password"
                invalid={
                  form.formState.errors.confirmPassword?.message !== undefined
                }
              >
                <Input type="password" {...form.register("confirmPassword")} />
              </HorizontalFormControl>
              {register.error && (
                <Alert.Root
                  borderStartWidth="4px"
                  borderStartColor="colorPalette.solid"
                  colorPalette="red"
                >
                  <Alert.Content>
                    <Alert.Description>
                      {register.error.message}
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}
              <HStack width="full" paddingTop={4}>
                <Link href="/auth/signin" textDecoration="underline">
                  Already have an account?
                </Link>
                <Spacer />
                <Button
                  colorPalette="orange"
                  type="submit"
                  loading={register.isLoading || signInLoading}
                >
                  Sign up
                </Button>
              </HStack>
            </VStack>
          </Card.Body>
        </Card.Root>
      </form>
    </Container>
  );
}

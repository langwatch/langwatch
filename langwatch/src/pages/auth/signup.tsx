import {
  Alert,
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
import { useSearchParams } from "~/utils/compat/next-navigation";
import { signIn, useSession } from "~/utils/auth-client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { Link } from "../../components/ui/link";
import { toaster } from "../../components/ui/toaster";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { api } from "../../utils/api";
import { authFailureMessage } from "./authFailureMessage";

const SIGN_UP_FALLBACK = "Sign up did not go through. Please try again.";

export default function SignUp() {
  const { data: session } = useSession();
  const publicEnv = usePublicEnv();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;
  const callbackUrl = useSearchParams()?.get("callbackUrl") ?? undefined;

  useEffect(() => {
    if (!publicEnv.data) {
      return;
    }

    if (!session && isAuthProvider && isAuthProvider !== "email") {
      void signIn(isAuthProvider, { callbackUrl });
    }
  }, [publicEnv.data, session, callbackUrl, isAuthProvider]);

  if (!publicEnv.data) {
    return null;
  }

  return isAuthProvider && isAuthProvider !== "email" ? (
    <div style={{ padding: "12px" }}>Redirecting to Sign in...</div>
  ) : (
    <SignUpForm />
  );
}

// Auth redirect is now handled client-side via useSession() + useEffect in the component

function SignUpForm() {
  const query = useSearchParams();
  const callbackUrl = query?.get("callbackUrl") ?? undefined;

  const schema = z
    .object({
      name: z.string().min(1, { message: "Name is required" }),
      email: z.string().min(1).email(),
      password: z
        .string()
        .min(8, { message: "Password must be at least 8 characters" }),
      confirmPassword: z
        .string()
        .min(8, { message: "Password must be at least 8 characters" }),
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
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setSubmitError(null);

    let message: string | null = null;
    try {
      await register.mutateAsync(values);

      setSignInLoading(true);
      const response = await signIn("credentials", {
        email: values.email,
        password: values.password,
        callbackUrl: callbackUrl,
      });

      if (response?.error ?? (response?.status && response.status >= 400)) {
        message = authFailureMessage({
          code: response.code,
          message: response.error,
          status: response.status,
          fallback: SIGN_UP_FALLBACK,
        });
      }
    } catch (error) {
      message = authFailureMessage({
        message: error instanceof Error ? error.message : void 0,
        fallback: SIGN_UP_FALLBACK,
      });
    } finally {
      setSignInLoading(false);
    }

    if (message) {
      setSubmitError(message);
      toaster.create({
        title: "Could not create your account",
        description: message,
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
              {(submitError ?? register.error?.message) && (
                <Alert.Root
                  borderStartWidth="4px"
                  borderStartColor="colorPalette.solid"
                  colorPalette="red"
                >
                  <Alert.Content>
                    <Alert.Description>
                      {submitError ?? register.error?.message}
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}
              <HStack width="full" paddingTop={4}>
                <Link
                  href={`/auth/signin${
                    callbackUrl
                      ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
                      : ""
                  }`}
                  textDecoration="underline"
                >
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

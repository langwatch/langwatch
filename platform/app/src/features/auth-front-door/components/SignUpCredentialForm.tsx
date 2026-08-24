import {
  Alert,
  Button,
  HStack,
  IconButton,
  Input,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { HorizontalFormControl } from "~/components/HorizontalFormControl";
import {
  applyHandledErrorToForm,
  FormServerError,
  HandledErrorAlert,
} from "~/features/errors";
import { authFailureMessage } from "~/pages/auth/authFailureMessage";
import { api } from "~/utils/api";
import { signIn } from "~/utils/auth-client";
import { credentialSignInFailure } from "../logic/credentialSignIn";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";
import "../authFrontDoor.css";
import { BRAND, SHAPE } from "../logic/brand";

/**
 * The strength rule the server enforces, said in the words the field shows.
 * One number in one place: a form that promised something looser than the
 * server would reject a password the person had already been told was fine.
 */
const MINIMUM_PASSWORD_LENGTH = 8;

const signUpSchema = z
  .object({
    name: z.string().min(1, { message: "Enter the name to call you by" }),
    password: z.string().min(MINIMUM_PASSWORD_LENGTH, {
      message: `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`,
    }),
    confirmPassword: z.string().min(MINIMUM_PASSWORD_LENGTH, {
      message: `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`,
    }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "The two passwords are not the same",
    path: ["confirmPassword"],
  });

type SignUpValues = z.infer<typeof signUpSchema>;

/**
 * The account exists by the time the sign-in leg runs, so a failure there says
 * so: implying the sign-up itself failed would send somebody back to create an
 * account they already have.
 */
const ACCOUNT_CREATED_FALLBACK =
  "Your account was created. Log in with your new details to carry on.";

/**
 * Holding a password as the sign-in method for an address that has already
 * been confirmed.
 *
 * The address is not asked for again and cannot be changed here: it was
 * confirmed by an emailed link, and letting this form carry a different one
 * would create an account for an address nobody proved. It rides along in a
 * hidden field all the same, so a password manager saves the pair.
 *
 * A rejection lands on the field that caused it, in words that say what to
 * change. Validation runs on blur in the same words, so most of the time the
 * server never has to answer at all.
 */
export function SignUpCredentialForm({
  verifiedEmail,
  callbackUrl,
}: {
  verifiedEmail: string;
  callbackUrl: string;
}) {
  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    mode: "onBlur",
  });
  const register = api.user.register.useMutation();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverErrorIsOnTheForm, setServerErrorIsOnTheForm] = useState(false);

  const onSubmit = async (values: SignUpValues) => {
    setSubmitError(null);
    setServerErrorIsOnTheForm(false);
    try {
      await register.mutateAsync({
        name: values.name,
        email: verifiedEmail,
        password: values.password,
      });
    } catch (error) {
      // A rejected field belongs next to that field. Anything the form has no
      // input for falls through to the alert below.
      setServerErrorIsOnTheForm(
        applyHandledErrorToForm({ error, form, hasFormErrorSlot: true }),
      );
      return;
    }

    setIsSigningIn(true);
    let message: string | null = null;
    try {
      const response = await signIn("credentials", {
        email: verifiedEmail,
        password: values.password,
        callbackUrl,
      });
      message =
        credentialSignInFailure({
          response,
          fallback: ACCOUNT_CREATED_FALLBACK,
        })?.message ?? null;
    } catch {
      message = authFailureMessage({ fallback: ACCOUNT_CREATED_FALLBACK });
    } finally {
      setIsSigningIn(false);
    }

    if (message) {
      setSubmitError(message);
      return;
    }
    rememberLastUsedMethod({ id: "password" });
  };

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
      <VStack width="full" align="stretch" gap={3}>
        <input
          type="hidden"
          name="email"
          value={verifiedEmail}
          autoComplete="username"
          readOnly
        />
        <HorizontalFormControl
          direction="vertical"
          size="sm"
          label="Name"
          helper="Enter your name"
          invalid={form.formState.errors.name?.message !== undefined}
          error={form.formState.errors.name}
        >
          <Input
            autoComplete="name"
            borderRadius={SHAPE.field}
            fontSize={{ base: "16px", md: "sm" }}
            minHeight="44px"
            {...form.register("name")}
          />
        </HorizontalFormControl>
        <HorizontalFormControl
          direction="vertical"
          size="sm"
          label="Password"
          helper={`At least ${MINIMUM_PASSWORD_LENGTH} characters`}
          invalid={form.formState.errors.password?.message !== undefined}
          error={form.formState.errors.password}
        >
          <HStack width="full" gap={2}>
            <Input
              type={isRevealed ? "text" : "password"}
              fontSize={{ base: "16px", md: "sm" }}
              minHeight="44px"
              borderRadius={SHAPE.field}
              autoComplete="new-password"
              {...form.register("password")}
            />
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={isRevealed ? "Hide password" : "Show password"}
              onClick={() => setIsRevealed((revealed) => !revealed)}
            >
              {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
            </IconButton>
          </HStack>
        </HorizontalFormControl>
        <HorizontalFormControl
          direction="vertical"
          size="sm"
          label="Confirm password"
          helper="Type your password again"
          invalid={form.formState.errors.confirmPassword?.message !== undefined}
          error={form.formState.errors.confirmPassword}
        >
          <Input
            type="password"
            fontSize={{ base: "16px", md: "sm" }}
            minHeight="44px"
            borderRadius={SHAPE.field}
            autoComplete="new-password"
            {...form.register("confirmPassword")}
          />
        </HorizontalFormControl>
        <FormServerError form={form} />
        {submitError ? (
          <Alert.Root
            status="error"
            borderStartWidth="4px"
            borderStartColor={BRAND.danger}
            color={BRAND.danger}
          >
            <Alert.Content>
              <Alert.Description>{submitError}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : register.error && !serverErrorIsOnTheForm ? (
          <HandledErrorAlert
            error={register.error}
            fallbackTitle="Couldn't create your account"
          />
        ) : null}
        <Button
          className="lw-front-door-primary"
          type="submit"
          width="full"
          minHeight="44px"
          marginTop={2}
          borderRadius={SHAPE.action}
          backgroundColor={BRAND.action}
          color={BRAND.onAction}
          _hover={{ backgroundColor: BRAND.actionHover }}
          loading={register.isPending || isSigningIn}
        >
          Create account
        </Button>
      </VStack>
    </form>
  );
}

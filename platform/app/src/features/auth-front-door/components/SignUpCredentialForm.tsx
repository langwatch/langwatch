import {
  Alert,
  Button,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";
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
import { FIELD_FOCUS, FIELD_SURFACE, FrontDoorField } from "./FrontDoorField";

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
      <VStack width="full" align="stretch" gap="13px">
        <input
          type="hidden"
          name="email"
          value={verifiedEmail}
          autoComplete="username"
          readOnly
        />
        <NameField form={form} />
        <NewPasswordField
          form={form}
          isRevealed={isRevealed}
          onToggleReveal={() => setIsRevealed((revealed) => !revealed)}
        />
        <ConfirmPasswordField form={form} />
        <FormServerError form={form} />
        <SignUpFailureAlert
          message={submitError}
          serverError={register.error}
          serverErrorIsOnTheForm={serverErrorIsOnTheForm}
        />
        <CreateAccountButton isPending={register.isPending || isSigningIn} />
      </VStack>
    </form>
  );
}

/** The name to call somebody by: the one thing asked that is not a password. */
function NameField({ form }: { form: UseFormReturn<SignUpValues> }) {
  return (
    <FrontDoorField label="Name" error={form.formState.errors.name}>
      {(id) => (
        <Input
          id={id}
          autoComplete="name"
          borderRadius={SHAPE.field}
          fontSize={{ base: "16px", md: "14px" }}
          minHeight="44px"
          {...FIELD_SURFACE}
          _focusVisible={FIELD_FOCUS}
          {...form.register("name")}
        />
      )}
    </FrontDoorField>
  );
}

/**
 * The password being set, with the strength rule said on the label line in the
 * same number the schema holds, and the reveal toggle beside the field.
 */
function NewPasswordField({
  form,
  isRevealed,
  onToggleReveal,
}: {
  form: UseFormReturn<SignUpValues>;
  isRevealed: boolean;
  onToggleReveal: () => void;
}) {
  return (
    <FrontDoorField
      label="Password"
      labelEnd={
        <Text fontSize="12px" color="fg.muted">
          At least {MINIMUM_PASSWORD_LENGTH} characters
        </Text>
      }
      error={form.formState.errors.password}
    >
      {(id) => (
        <HStack width="full" gap={2}>
          <Input
            id={id}
            type={isRevealed ? "text" : "password"}
            fontSize={{ base: "16px", md: "14px" }}
            minHeight="44px"
            borderRadius={SHAPE.field}
            autoComplete="new-password"
            {...FIELD_SURFACE}
            _focusVisible={FIELD_FOCUS}
            {...form.register("password")}
          />
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={isRevealed ? "Hide password" : "Show password"}
            onClick={onToggleReveal}
          >
            {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </IconButton>
        </HStack>
      )}
    </FrontDoorField>
  );
}

/** The same password again, never revealed: typing it twice is the check. */
function ConfirmPasswordField({ form }: { form: UseFormReturn<SignUpValues> }) {
  return (
    <FrontDoorField
      label="Confirm password"
      error={form.formState.errors.confirmPassword}
    >
      {(id) => (
        <Input
          id={id}
          type="password"
          fontSize={{ base: "16px", md: "14px" }}
          minHeight="44px"
          borderRadius={SHAPE.field}
          autoComplete="new-password"
          {...FIELD_SURFACE}
          _focusVisible={FIELD_FOCUS}
          {...form.register("confirmPassword")}
        />
      )}
    </FrontDoorField>
  );
}

/**
 * What went wrong once the form was accepted: a message the sign-in leg wrote,
 * or a refusal from the server that no field of this form owns.
 */
function SignUpFailureAlert({
  message,
  serverError,
  serverErrorIsOnTheForm,
}: {
  message: string | null;
  serverError: unknown;
  serverErrorIsOnTheForm: boolean;
}) {
  if (message) {
    return (
      <Alert.Root
        status="error"
        borderStartWidth="4px"
        borderStartColor={BRAND.danger}
        color={BRAND.danger}
      >
        <Alert.Content>
          <Alert.Description>{message}</Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  if (serverError && !serverErrorIsOnTheForm) {
    return (
      <HandledErrorAlert
        error={serverError}
        fallbackTitle="Couldn't create your account"
      />
    );
  }

  return null;
}

/** The one action the screen offers, held down while either leg is running. */
function CreateAccountButton({ isPending }: { isPending: boolean }) {
  return (
    <Button
      className="lw-front-door-primary"
      type="submit"
      width="full"
      minHeight="44px"
      marginTop={2}
      fontWeight={600}
      borderRadius={SHAPE.action}
      backgroundColor={BRAND.action}
      color={BRAND.onAction}
      _hover={{ backgroundColor: BRAND.actionHover }}
      loading={isPending}
    >
      Create account
    </Button>
  );
}

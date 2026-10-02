import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "@langwatch/browser-host/link";
import { Box, Button, Text, VStack } from "@langwatch/design-system/primitives";
import { describePasswordProblem } from "@langwatch/identity-contract";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { authClient } from "../../behavior/auth-client.tsx";
import { registerUiPasskey } from "../../behavior/ui-passkeys.ts";
import { usePublicEnv } from "../../behavior/use-public-env.ts";
import { useSearchParams } from "../../behavior/use-route.ts";
import { SHAPE } from "../../model/front-door-theme.ts";
import { passkeyFailure } from "../../model/passkey-failure.ts";
import { readHandledError } from "../../model/read-handled-error.ts";
import { AuthCard } from "../../ui/elements/auth-card.tsx";
import { FrontDoorField } from "../../ui/elements/front-door-field.tsx";
import { HandledErrorAlert } from "../../ui/elements/handled-error-alert.tsx";
import { PasswordInput } from "../../ui/elements/password-input.tsx";
import { FrontDoorShell } from "./front-door-shell.tsx";

// The one password policy, from the module that owns it, so reset cannot accept
// what sign-up refuses.
const resetPasswordSchema = z
  .object({
    password: z.string().superRefine((value, ctx) => {
      const problem = describePasswordProblem(value);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

type ResetRefusal = { error: unknown; linkIsDead: boolean; waitLine: string | null };

/**
 * Only a refusal about the token is a dead link: telling somebody whose password
 * was refused that their link expired sends them to burn a fresh one.
 */
function readResetRefusal(error: {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}): ResetRefusal {
  const handled = readHandledError(error);
  if (handled) {
    return { error, linkIsDead: handled.code === "identity_reset_link_invalid", waitLine: null };
  }
  if (error.status === 429) {
    return {
      error: null,
      linkIsDead: false,
      waitLine: "Too many attempts. Wait a minute, then try again.",
    };
  }
  const linkIsDead = (error.code ?? "").toUpperCase().includes("TOKEN");
  return {
    error: linkIsDead ? { error: "identity_reset_link_invalid" } : error,
    linkIsDead,
    waitLine: null,
  };
}

/**
 * Setting the new password the emailed link authorises (D13, ADR-117 §6). A completed
 * reset signs the device in and offers a passkey in place. specs/auth/password-reset.feature
 */
export default function ResetPassword() {
  const query = useSearchParams();
  const token = query?.get("token") ?? null;

  return (
    <FrontDoorShell>
      {token ? <ResetPasswordForm token={token} /> : <DeadLinkCard />}
    </FrontDoorShell>
  );
}

function DeadLinkCard() {
  return (
    <AuthCard
      title="That reset link didn't work"
      intro="Reset links can be opened once, and they expire an hour after they are sent."
    >
      <RequestNewLink />
      <BackToSignIn />
    </AuthCard>
  );
}

function ResetPasswordForm({ token }: { token: string }) {
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [refusal, setRefusal] = useState<ResetRefusal | null>(null);

  const onSubmit = async (values: ResetPasswordValues) => {
    setIsLoading(true);
    setRefusal(null);
    try {
      const result = await authClient.resetPassword({ newPassword: values.password, token });
      if (result?.error) {
        setRefusal(readResetRefusal(result.error));
        return;
      }
      setIsDone(true);
    } catch {
      // A throw is transport, not a verdict on the link.
      setRefusal({ error: new Error("reset request failed"), linkIsDead: false, waitLine: null });
    } finally {
      setIsLoading(false);
    }
  };

  if (isDone) return <PasswordUpdatedCard />;

  return (
    <AuthCard
      title="Choose a new password"
      intro="Type it twice so a slip cannot lock you out again."
    >
      <HandledErrorAlert
        error={refusal?.error}
        fallbackTitle="Couldn't reset your password"
        className="lw-front-door-alert"
      />
      {refusal?.linkIsDead ? <RequestNewLink /> : null}
      {refusal?.waitLine ? (
        <Text fontSize="13px" lineHeight="1.55" color="fg.error" data-testid="reset-wait">
          {refusal.waitLine}
        </Text>
      ) : null}
      <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <VStack width="full" align="stretch" gap="14px">
          <FrontDoorField label="New password" error={form.formState.errors.password}>
            {(id) => (
              <PasswordInput
                id={id}
                autoComplete="new-password"
                registration={form.register("password")}
              />
            )}
          </FrontDoorField>
          <FrontDoorField label="Confirm password" error={form.formState.errors.confirmPassword}>
            {(id) => (
              <PasswordInput
                id={id}
                autoComplete="new-password"
                registration={form.register("confirmPassword")}
              />
            )}
          </FrontDoorField>
          <PrimaryButton type="submit" loading={isLoading}>
            Reset password
          </PrimaryButton>
          <BackToSignIn />
        </VStack>
      </form>
    </AuthCard>
  );
}

/**
 * The reset already opened the session, so the way on is to continue. The passkey offer
 * starts its ceremony on the click only, and never stands in front of Continue.
 */
function PasswordUpdatedCard() {
  const publicEnv = usePublicEnv();
  const offersPasskeys = publicEnv.data?.PASSKEYS_ENABLED === true;
  const [state, setState] = useState<"offer" | "registering" | "added" | "dismissed">("offer");
  const [failure, setFailure] = useState<unknown>(null);

  const addPasskey = async () => {
    setFailure(null);
    setState("registering");
    const outcome = await registerUiPasskey();
    if (outcome.ok) {
      setState("added");
      return;
    }
    // Closing the device's own prompt is a decision, not a failure.
    if (!outcome.cancelled) setFailure(passkeyFailure(void 0));
    setState("offer");
  };

  return (
    <AuthCard
      title="Password updated"
      intro="You are signed in with your new password. Every other device was signed out."
    >
      <HandledErrorAlert
        error={failure}
        fallbackTitle="That passkey wasn't created"
        className="lw-front-door-alert"
      />
      <Button {...PRIMARY_STYLE} asChild>
        <Link href="/" data-testid="reset-sign-in">
          Continue
        </Link>
      </Button>
      {offersPasskeys ? (
        <PostResetPasskeyOffer
          state={state}
          onAdd={() => void addPasskey()}
          onDismiss={() => setState("dismissed")}
        />
      ) : null}
    </AuthCard>
  );
}

function PostResetPasskeyOffer({
  state,
  onAdd,
  onDismiss,
}: {
  state: "offer" | "registering" | "added" | "dismissed";
  onAdd: () => void;
  onDismiss: () => void;
}) {
  if (state === "dismissed") return null;
  if (state === "registering") {
    return (
      <Text
        fontSize="14px"
        fontWeight={600}
        textAlign="center"
        data-testid="reset-passkey-ceremony-title"
      >
        Follow your device's prompt to create a passkey
      </Text>
    );
  }
  if (state === "added") {
    return (
      <VStack width="full" align="stretch" gap="6px" textAlign="center">
        <Text fontSize="13.5px" fontWeight={600} data-testid="reset-passkey-added">
          Passkey added
        </Text>
        <Text fontSize="13px" lineHeight="1.6" color="fg.muted">
          Next time you can sign in with your fingerprint, face or screen lock instead of typing a
          password.
        </Text>
      </VStack>
    );
  }
  return (
    <VStack
      width="full"
      align="stretch"
      gap="10px"
      textAlign="center"
      data-testid="post-reset-passkey-offer"
    >
      <Text fontSize="13px" lineHeight="1.6" color="fg.muted">
        Next time, skip the password. A passkey uses the fingerprint, face or screen lock your
        device already has, and there is nothing to forget.
      </Text>
      <Button
        variant="outline"
        width="full"
        minHeight="42px"
        fontSize="13.5px"
        borderRadius={SHAPE.field}
        onClick={onAdd}
        data-testid="reset-add-passkey"
      >
        Add a passkey
      </Button>
      <Button
        variant="plain"
        size="sm"
        alignSelf="center"
        fontSize="13px"
        color="fg.muted"
        onClick={onDismiss}
        data-testid="reset-dismiss-passkey"
      >
        Not now
      </Button>
    </VStack>
  );
}

const PRIMARY_STYLE = {
  className: "lw-front-door-primary",
  width: "full",
  minHeight: "44px",
  fontSize: "14px",
  fontWeight: 600,
  backgroundColor: "frontDoor.action",
  color: "frontDoor.onAction",
  _hover: { backgroundColor: "frontDoor.actionHover" },
} as const;

function PrimaryButton({
  type,
  loading,
  children,
}: {
  type: "submit";
  loading: boolean;
  children: string;
}) {
  return (
    <Button {...PRIMARY_STYLE} type={type} loading={loading}>
      {children}
    </Button>
  );
}

function RequestNewLink() {
  return (
    <Text width="full" textAlign="center" fontSize="13px" color="fg.muted">
      <QuietLink href="/auth/forgot-password">Request a new reset link</QuietLink>
    </Text>
  );
}

function BackToSignIn() {
  return (
    <Text width="full" textAlign="center" fontSize="13px" color="fg.muted">
      <QuietLink href="/auth/signin">Back to sign in</QuietLink>
    </Text>
  );
}

function QuietLink({ href, children }: { href: string; children: string }) {
  return (
    <Box
      asChild
      color="fg"
      fontWeight={600}
      textDecoration="underline"
      textUnderlineOffset="3px"
      textDecorationColor="border"
      _hover={{ textDecorationColor: "fg" }}
    >
      <Link href={href}>{children}</Link>
    </Box>
  );
}

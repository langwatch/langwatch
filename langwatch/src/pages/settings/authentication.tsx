import {
  Button,
  Card,
  Field,
  Heading,
  HStack,
  IconButton,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn, useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { LuKeyRound, LuX } from "react-icons/lu";
import { z } from "zod";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import SettingsLayout from "../../components/SettingsLayout";
import { toaster } from "../../components/ui/toaster";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { api } from "../../utils/api";
import { titleCase } from "../../utils/stringCasing";

const getProviderDisplayName = (
  provider: string,
  providerAccountId: string,
) => {
  if (provider === "auth0") {
    // For other auth0 providers, the ID format is "provider|id"
    const [actualProvider] = providerAccountId.split("|");

    const providerMap: Record<string, string> = {
      auth0: "Email/Password",
      "google-oauth2": "Google",
      windowslive: "Microsoft",
      github: "GitHub",
    };

    return (
      (providerMap[actualProvider ?? ""] ??
        titleCase(actualProvider ?? "unknown")) + " (via auth0)"
    );
  }
  return titleCase(provider);
};

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z
      .string()
      .min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

export default function AuthenticationSettings() {
  const { data: accounts, isLoading } = api.user.getLinkedAccounts.useQuery({});
  const unlinkAccount = api.user.unlinkAccount.useMutation();
  const changePasswordMutation = api.user.changePassword.useMutation();
  const { organization } = useOrganizationTeamProject();
  const { data: session } = useSession();
  const publicEnv = usePublicEnv();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;
  const apiContext = api.useContext();

  const passwordForm = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const hasSSOProvider = !!organization?.ssoProvider;

  if (!isAuthProvider) {
    return null;
  }

  const handleLinkProvider = () => {
    if (isAuthProvider) {
      void signIn(isAuthProvider, {
        callbackUrl: window.location.href,
      });
    }
  };

  const handleUnlink = async (accountId: string) => {
    try {
      await unlinkAccount.mutateAsync({ accountId });
      await apiContext.user.getLinkedAccounts.invalidate();
      toaster.create({
        title: "Sign-in method removed",
        type: "success",
        meta: {
          closable: true,
        },
      });
    } catch (error) {
      toaster.create({
        title: "Failed to remove sign-in method",
        description:
          error instanceof Error ? error.message : "Please try again",
        type: "error",
        meta: {
          closable: true,
        },
      });
    }
  };

  const onPasswordSubmit = async (values: ChangePasswordFormValues) => {
    try {
      await changePasswordMutation.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toaster.create({
        title: "Password changed successfully",
        type: "success",
        meta: {
          closable: true,
        },
      });
      passwordForm.reset();
    } catch (error) {
      toaster.create({
        title: "Failed to change password",
        description:
          error instanceof Error ? error.message : "Please try again",
        type: "error",
        meta: {
          closable: true,
        },
      });
    }
  };

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <VStack align="start" gap={1}>
          <Heading as="h2">Authentication Settings</Heading>
          <Text>({session?.user?.email})</Text>
        </VStack>

        {publicEnv.data?.NEXTAUTH_PROVIDER === "email" && (
          <HorizontalFormControl
            label="Change Password"
            helper={<Text>Password must be at least 8 characters long.</Text>}
          >
            {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
            <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}>
              <VStack width="full" align="stretch" gap={4} marginTop={4}>
                <Field.Root
                  invalid={!!passwordForm.formState.errors.currentPassword}
                >
                  <Field.Label>Current Password</Field.Label>
                  <Input
                    type="password"
                    {...passwordForm.register("currentPassword")}
                  />
                  {passwordForm.formState.errors.currentPassword && (
                    <Field.ErrorText>
                      {passwordForm.formState.errors.currentPassword.message}
                    </Field.ErrorText>
                  )}
                </Field.Root>
                <Field.Root
                  invalid={!!passwordForm.formState.errors.newPassword}
                >
                  <Field.Label>New Password</Field.Label>
                  <Input
                    type="password"
                    {...passwordForm.register("newPassword")}
                  />
                  {passwordForm.formState.errors.newPassword && (
                    <Field.ErrorText>
                      {passwordForm.formState.errors.newPassword.message}
                    </Field.ErrorText>
                  )}
                </Field.Root>
                <Field.Root
                  invalid={!!passwordForm.formState.errors.confirmPassword}
                >
                  <Field.Label>Confirm New Password</Field.Label>
                  <Input
                    type="password"
                    {...passwordForm.register("confirmPassword")}
                  />
                  {passwordForm.formState.errors.confirmPassword && (
                    <Field.ErrorText>
                      {passwordForm.formState.errors.confirmPassword.message}
                    </Field.ErrorText>
                  )}
                </Field.Root>
                <HStack width="full" justify="end">
                  <Button
                    type="submit"
                    colorPalette="orange"
                    disabled={changePasswordMutation.isPending}
                    loading={changePasswordMutation.isPending}
                  >
                    Change Password
                  </Button>
                </HStack>
              </VStack>
            </form>
          </HorizontalFormControl>
        )}

        {publicEnv.data?.NEXTAUTH_PROVIDER &&
          publicEnv.data?.NEXTAUTH_PROVIDER !== "email" && (
            <HorizontalFormControl
              label="Linked Sign-in Methods"
              helper={
                !hasSSOProvider ? (
                  <Text>
                    You can link additional sign-in methods to your account.
                    <br />
                    All linked methods must use the same email address as your
                    main account.
                  </Text>
                ) : (
                  <Text>
                    You are linked via your company&apos;s SSO provider.
                    <br />
                    No additional sign-in methods can be linked.
                  </Text>
                )
              }
            >
              {isLoading ? (
                <Spinner />
              ) : (
                <VStack width="full" align="end" gap={6} marginTop={4}>
                  <VStack align="start" gap={1}>
                    {accounts?.map((account) => (
                      <HStack key={account.id} width="full">
                        <LuKeyRound />
                        <Text>
                          {getProviderDisplayName(
                            account.provider,
                            account.providerAccountId,
                          )}
                        </Text>
                        <Spacer />
                        {accounts.length > 1 && (
                          <IconButton
                            aria-label="Remove sign-in method"
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleUnlink(account.id)}
                            disabled={unlinkAccount.isLoading}
                          >
                            <LuX />
                          </IconButton>
                        )}
                      </HStack>
                    ))}
                  </VStack>
                  <Button
                    onClick={handleLinkProvider}
                    colorPalette="orange"
                    disabled={hasSSOProvider}
                  >
                    Link New Sign-in Method
                  </Button>
                </VStack>
              )}
            </HorizontalFormControl>
          )}
      </VStack>
    </SettingsLayout>
  );
}

import { Center, Spinner, Text, VStack } from "@chakra-ui/react";
import { useEffect, type PropsWithChildren } from "react";
import SettingsLayout from "~/components/SettingsLayout";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

/**
 * Admin-gated shell for every /ops/backoffice/:resource page.
 *
 * Renders inside {@link SettingsLayout} so Backoffice uses the same left
 * sidebar (with its Users / Organizations / Projects / Subscriptions /
 * Organization Features sub-section) and the same Chakra design language as
 * the rest of Settings — no more custom two-column Backoffice layout.
 *
 * Admin gating is decoupled from `ops:view` on purpose: if that scope ever
 * broadens beyond admins, Backoffice stays strictly admin-only. Errors from
 * the `isAdmin` lookup also redirect so the page never hangs in a spinner.
 */
export default function BackofficeShell({ children }: PropsWithChildren) {
  const router = useRouter();
  const adminStatus = api.user.isAdmin.useQuery(
    {},
    { retry: false, refetchOnWindowFocus: false },
  );

  const hasAccess = adminStatus.data?.isAdmin === true;
  const isDenied =
    (adminStatus.isSuccess && !hasAccess) || adminStatus.isError;

  useEffect(() => {
    if (isDenied) {
      void router.push("/");
    }
  }, [isDenied, router]);

  if (!hasAccess) {
    return (
      <SettingsLayout>
        <Center paddingY={20}>
          <VStack gap={3}>
            {!isDenied && <Spinner size="lg" />}
            <Text color="fg.muted" fontSize="sm">
              {isDenied ? "Access denied" : "Loading Backoffice…"}
            </Text>
          </VStack>
        </Center>
      </SettingsLayout>
    );
  }

  return <SettingsLayout>{children}</SettingsLayout>;
}

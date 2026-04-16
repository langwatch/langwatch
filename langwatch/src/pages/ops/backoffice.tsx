import { Center, Spinner, Text, VStack } from "@chakra-ui/react";
import { useEffect } from "react";
import ClientAdminWrapper from "../../../ee/admin/ClientAdminWrapper";
import BackofficeLayout from "~/components/ops/backoffice/BackofficeLayout";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { useRouter } from "~/utils/compat/next-router";
import { api } from "~/utils/api";

/**
 * OPS Backoffice — admin CRUD surfaces lifted into the OPS section.
 *
 * Wraps the existing react-admin <Admin> app (unchanged business logic) inside
 * the OPS shell + Settings-style two-column layout. basename="/ops/backoffice"
 * tells react-admin to mount its own router at this path.
 *
 * Access: gated client-side via user.isAdmin (and always re-checked server-side
 * by /api/admin/*). Non-admins are redirected to "/".
 */
export default function BackofficePage() {
  const router = useRouter();
  const adminStatus = api.user.isAdmin.useQuery(
    {},
    { retry: false, refetchOnWindowFocus: false },
  );

  const hasAccess = adminStatus.data?.isAdmin;
  const isDenied = adminStatus.isSuccess && !hasAccess;

  useEffect(() => {
    if (isDenied) {
      void router.push("/");
    }
  }, [isDenied, router]);

  if (adminStatus.isLoading || !hasAccess) {
    return (
      <OpsPageShell>
        <BackofficeLayout>
          <Center paddingY={20}>
            <VStack gap={3}>
              <Spinner size="lg" />
              <Text color="fg.muted" fontSize="sm">
                {isDenied ? "Access denied" : "Loading Backoffice…"}
              </Text>
            </VStack>
          </Center>
        </BackofficeLayout>
      </OpsPageShell>
    );
  }

  return (
    <OpsPageShell>
      <BackofficeLayout>
        <ClientAdminWrapper basename="/ops/backoffice" />
      </BackofficeLayout>
    </OpsPageShell>
  );
}

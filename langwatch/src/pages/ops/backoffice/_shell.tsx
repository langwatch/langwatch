import { Center, Spinner, Text, VStack } from "@chakra-ui/react";
import { useEffect, type PropsWithChildren } from "react";
import BackofficeLayout from "~/components/ops/backoffice/BackofficeLayout";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

/**
 * Admin-gated shell shared by every /ops/backoffice/:resource page.
 *
 * Two layers of defence:
 *  - OpsPageShell enforces the ops permission (which currently is admin-only
 *    per resolveOpsScope).
 *  - user.isAdmin explicitly re-checks the caller's admin email, decoupled
 *    from OPS access in case the ops:view scope ever broadens.
 * Errors from the isAdmin lookup also redirect so the page never hangs.
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
      <OpsPageShell>
        <BackofficeLayout>
          <Center paddingY={20}>
            <VStack gap={3}>
              {!isDenied && <Spinner size="lg" />}
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
      <BackofficeLayout>{children}</BackofficeLayout>
    </OpsPageShell>
  );
}

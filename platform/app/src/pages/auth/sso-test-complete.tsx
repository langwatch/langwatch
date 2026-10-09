import { Button, Text, VStack } from "@chakra-ui/react";
import { AuthCard } from "~/components/auth/AuthCard";
import { AuthShell } from "~/features/auth";
import { AUTH_PRIMARY_STYLE } from "~/features/auth/components/AuthPrimaryButton";
import { api } from "~/utils/api";
import { signOut, useSession } from "~/utils/auth-client";

/**
 * Where a test sign-in leaves the administrator who performed it.
 *
 * THE SCREEN THIS REPLACES SAID THE OPPOSITE OF WHAT HAPPENED. Turning a
 * connection on requires a test sign-in, and that sign-in necessarily happens
 * before the connection is live — so it signs the administrator in as somebody
 * the connection has not admitted, holding no membership. The orgless landing
 * read that as a brand new customer and offered to create an organization,
 * which reads as "your test failed, start from nothing" and, if taken, leaves
 * the setup they were two steps from finishing inside a second empty
 * organization.
 *
 * So it says the true thing instead: the round trip worked, that is what the
 * step was for, and the way on is back to their own account.
 */
export default function SsoTestComplete() {
  return (
    <AuthShell>
      <SsoTestCompleteCard />
    </AuthShell>
  );
}

function SsoTestCompleteCard() {
  const { data: session } = useSession();
  // The same server answer the landing redirect read to send them here, so
  // the page cannot contradict the decision that opened it.
  const arrival = api.identity.myTestArrival.useQuery(
    {},
    { staleTime: 60_000, retry: false },
  );

  const signedInAs = session?.user?.email ?? null;
  const organizationName = arrival.data?.organizationName ?? null;

  return (
    <AuthCard title="That test sign-in worked">
      <VStack width="full" align="stretch" gap="14px">
        <Text color="fg.muted">
          Your identity provider signed you in
          {signedInAs ? <> as {signedInAs}</> : null}, which is exactly what the
          test was for.
        </Text>
        <Text color="fg.muted">
          That address is not a member of{" "}
          {organizationName ?? "your organization"} yet, because the connection
          is not turned on — so there is nothing here for it to do. Sign back in
          as yourself to finish turning the connection on.
        </Text>
        <Button
          {...AUTH_PRIMARY_STYLE}
          onClick={() => void signOut()}
          data-testid="sso-test-complete-sign-out"
        >
          Sign back in as yourself
        </Button>
      </VStack>
    </AuthCard>
  );
}

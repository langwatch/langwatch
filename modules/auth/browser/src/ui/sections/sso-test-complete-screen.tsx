import { Button, Text, VStack } from "@chakra-ui/react";

import { authApi as api } from "../../behavior/auth-api.ts";
import { signOut, useSession } from "../../behavior/auth-client.tsx";
import { AuthCard } from "../elements/auth-card.tsx";

/**
 * Where a test sign-in leaves its administrator: it worked, and the way on is
 * back to their own account. Spec: specs/identity/sso-activation.feature.
 */
export default function SsoTestComplete() {
  const { data: session } = useSession();
  // The same server answer the landing redirect read to send them here.
  const arrival = api.identity.myTestArrival.useQuery({}, { staleTime: 60_000, retry: false });

  const signedInAs = session?.user?.email ?? null;
  const organizationName = arrival.data?.testing ? arrival.data.organizationName : null;

  return (
    <AuthCard title="That test sign-in worked">
      <VStack width="full" align="stretch" gap="14px">
        <Text color="fg.muted">
          Your identity provider signed you in
          {signedInAs ? <> as {signedInAs}</> : null}, which is exactly what the test was for.
        </Text>
        <Text color="fg.muted">
          That address is not a member of {organizationName ?? "your organization"} yet, because the
          connection is not turned on, so there is nothing here for it to do. Sign back in as
          yourself to finish turning the connection on.
        </Text>
        <Button
          colorPalette="orange"
          width="full"
          onClick={() => void signOut()}
          data-testid="sso-test-complete-sign-out"
        >
          Sign back in as yourself
        </Button>
      </VStack>
    </AuthCard>
  );
}

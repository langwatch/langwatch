/**
 * The enrolment gate: a gate, not a sign-out. It names the organization asking,
 * offers the setup on the spot, and swaps only the page body, so the switcher in
 * the chrome still reaches every other organization. The shell lends it the body.
 */
import { Box, Card, Heading, Text, VStack } from "@chakra-ui/react";
import { explainAnyError } from "@langwatch/error-presentation/presentation";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { personalWorkspaceApi } from "../../../../behavior/personal-workspace-api.ts";
import { useOrganizationMfaGate } from "../../behavior/use-organization-mfa-gate.ts";
import { TwoStepSetupFlow } from "./two-step-setup-flow.tsx";

/** The registry's words for the refusal this screen is, so every surface for it agrees. */
const HELD_AT_THE_GATE = explainAnyError({ error: { code: "identity_mfa_enrollment_required" } });

export default function OrganizationMfaGate({
  organizationId,
  isPersonalScope,
  children,
}: {
  organizationId: string | undefined;
  isPersonalScope: boolean;
  children: ReactNode;
}) {
  const { gate, refresh } = useOrganizationMfaGate({ organizationId, isPersonalScope });
  const passwordStatus = personalWorkspaceApi.user.hasPassword.useQuery({}, { enabled: gate.held });

  if (!gate.held) return <>{children}</>;

  return (
    <Box
      width="full"
      display="flex"
      justifyContent="center"
      paddingY={10}
      paddingX={4}
      data-testid="organization-mfa-gate"
    >
      <VStack align="stretch" gap={6} maxWidth="560px" width="full">
        <VStack align="start" gap={2}>
          <Box color="fg.muted">
            <ShieldCheck size={28} />
          </Box>
          <Heading as="h1" size="lg">
            {gate.organizationName} requires two-step verification
          </Heading>
          <Text color="fg.muted">{HELD_AT_THE_GATE.description}</Text>
          {gate.offerPasskey && (
            <Text color="fg.muted" data-testid="organization-mfa-gate-passkey">
              You can also sign in again with your passkey, which counts as your second factor.
            </Text>
          )}
        </VStack>

        <Card.Root width="full">
          <Card.Body>
            {/* Nothing to cancel back to, so a cancel only asks the standing again. */}
            <TwoStepSetupFlow
              holdsPassword={passwordStatus.data?.hasPassword ?? true}
              onFinished={refresh}
              onCancel={refresh}
            />
          </Card.Body>
        </Card.Root>
      </VStack>
    </Box>
  );
}

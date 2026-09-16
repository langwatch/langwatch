/**
 * Two-step verification: the second proof, beside passkeys. `MfaGuardsService`
 * exists on the server but no transport reaches it yet, see the handoff.
 */

import { HStack, Text, VStack } from "@chakra-ui/react";
import { Smartphone } from "lucide-react";

export function TwoFactorSection() {
  return (
    <VStack align="start" gap={1} width="full" data-testid="two-factor-section">
      <HStack gap={2}>
        <Smartphone size={18} />
        <Text fontWeight={600}>Two-step verification</Text>
      </HStack>
      <Text color="fg.muted" fontSize="sm">
        Two-step verification is not available on this deployment yet.
      </Text>
    </VStack>
  );
}

/**
 * Where you are signed in: the browsers holding a live sign-in to this
 * account. Not wired to real data yet - no procedure on this branch reads
 * a session by browser and device; see the handoff for what is missing.
 */

import { HStack, Text, VStack } from "@chakra-ui/react";
import { Monitor } from "lucide-react";

export function BrowserSessionsSection() {
  return (
    <VStack align="start" gap={2} width="full" data-testid="browser-sessions-section">
      <HStack gap={2}>
        <Monitor size={18} />
        <Text fontWeight={600}>Where you are signed in</Text>
      </HStack>
      <Text fontSize="sm" color="fg.muted">
        Not available on this build yet.
      </Text>
    </VStack>
  );
}

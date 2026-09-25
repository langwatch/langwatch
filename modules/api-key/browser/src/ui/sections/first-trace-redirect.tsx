/**
 * Waiting/success line under the CLI card. Rendering nothing is deliberate when
 * traces already exist.
 */

import { HStack, Icon, Spinner, Text } from "@chakra-ui/react";
import { CheckCircle2 } from "lucide-react";

import { useFirstTraceWatch } from "../../behavior/use-first-trace-watch.ts";

export function FirstTraceRedirect() {
  const watchState = useFirstTraceWatch();

  if (watchState === "redirecting") {
    return (
      <HStack as="output" gap={2} aria-live="polite">
        <Icon as={CheckCircle2} boxSize={4} color="green.fg" />
        <Text textStyle="sm" color="fg.muted">
          First trace received. Taking you there now.
        </Text>
      </HStack>
    );
  }

  if (watchState === "waiting") {
    return (
      <HStack as="output" gap={2} aria-live="polite">
        <Spinner size="sm" color="orange.400" />
        <Text textStyle="sm" color="fg.muted">
          Waiting for your first trace. We will take you there when it arrives.
        </Text>
      </HStack>
    );
  }

  return null;
}

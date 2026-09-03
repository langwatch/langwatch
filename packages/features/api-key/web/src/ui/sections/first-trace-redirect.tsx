/**
 * The line under the CLI success card while we wait for the reader's first
 * trace, and the announcement when it arrives.
 *
 * The rendering half of `platform/app/src/pages/cli/FirstTraceRedirect.tsx`; the
 * watch is `behavior/use-first-trace-watch.ts` and the policy it applies is
 * `model/first-trace-policy.ts`. Rendering nothing is the common case, and it is
 * deliberate: a reader whose project already has traces keeps the plain
 * close-this-tab card rather than being told about a wait that will not happen.
 */

import { HStack, Icon, Spinner, Text } from "@chakra-ui/react";
import { CheckCircle2 } from "lucide-react";
import { useFirstTraceWatch } from "../../behavior/use-first-trace-watch";

export function FirstTraceRedirect() {
  const watchState = useFirstTraceWatch();

  if (watchState === "redirecting") {
    return (
      <HStack gap={2} role="status" aria-live="polite">
        <Icon as={CheckCircle2} boxSize={4} color="green.fg" />
        <Text textStyle="sm" color="fg.muted">
          First trace received. Taking you there now.
        </Text>
      </HStack>
    );
  }

  if (watchState === "waiting") {
    return (
      <HStack gap={2} role="status" aria-live="polite">
        <Spinner size="sm" color="orange.400" />
        <Text textStyle="sm" color="fg.muted">
          Waiting for your first trace. We will take you there when it arrives.
        </Text>
      </HStack>
    );
  }

  return null;
}

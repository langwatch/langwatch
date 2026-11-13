// The Signing keys tab. The api-key module lends the panel (SigningKeysPanelToken); below
// Enterprise it is not mounted, since the whole page is paused.

import { SigningKeysPanelToken } from "@langwatch/api-key-client";
import { Lent } from "@langwatch/browser-host/lent";
import { Text } from "@langwatch/design-system/primitives";

import type { BraidsPlanState } from "../../../model/braids/braids.ts";

export function BraidsSigningKeys({
  projectId,
  planState,
}: {
  projectId: string;
  planState: BraidsPlanState;
}) {
  if (planState !== "enterprise") {
    return (
      <Text color="fg.muted" paddingY={6} data-testid="braids-signing-keys-paused">
        Signing keys need the Enterprise plan. Existing keys are kept.
      </Text>
    );
  }
  return <Lent of={SigningKeysPanelToken} props={{ projectId }} />;
}

import { AccessState } from "@langwatch/design-system/access-state";
import { Button, Center } from "@langwatch/design-system/primitives";

import { useGovernanceHost } from "../../model/governance-host.ts";

export function NotFoundScene() {
  const host = useGovernanceHost();
  return (
    <Center minHeight="50vh" padding={{ base: 4, md: 8 }}>
      <AccessState
        kind="unavailable"
        title="This page is not here"
        description="The address may have changed, or this page isn't available for your organization. Go back to your dashboard to continue."
        actions={
          <Button colorPalette="orange" size="sm" onClick={() => host.navigate("/")}>
            Go to the dashboard
          </Button>
        }
      />
    </Center>
  );
}

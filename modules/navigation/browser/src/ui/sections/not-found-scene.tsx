import { AccessState } from "@langwatch/design-system/access-state";
import { Button, Center } from "@langwatch/design-system/primitives";

import { useNavigationHost } from "../../model/navigation-host.ts";

export function NotFoundScene() {
  const host = useNavigationHost();
  return (
    <Center minHeight="50vh" padding={{ base: 4, md: 8 }}>
      <AccessState
        kind="unavailable"
        title="This page is not here"
        description="The address may have changed, or this page isn't available for your organization. Go back to your dashboard to continue."
        actions={
          <Button size="sm" colorPalette="orange" onClick={() => host.navigate("/")}>
            Go to the dashboard
          </Button>
        }
      />
    </Center>
  );
}

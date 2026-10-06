import { Drawer } from "@langwatch/design-system/drawer";
import type { UiProvisioningSetupDrawerProps } from "@langwatch/enterprise-scim-contract";
import type React from "react";

import { useScimHost } from "../../model/scim-host.ts";
import { ScimSettingsContent } from "./scim.screen.tsx";

/** SCIM provisioning in a drawer, so the single sign-on errand finishes where it started. */
export function ProvisioningSetupDrawer({
  open = true,
}: UiProvisioningSetupDrawerProps): React.ReactElement {
  const host = useScimHost();
  const organizationId = host.organizationId();

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="lg"
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) host.closeOverlay();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>SCIM Provisioning</Drawer.Title>
          <Drawer.CloseTrigger onClick={() => host.closeOverlay()} />
        </Drawer.Header>
        <Drawer.Body>
          {organizationId && (
            <ScimSettingsContent
              organizationId={organizationId}
              lede="Let your identity provider create and remove accounts here as people join and leave."
            />
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * /settings/authentication/connectors: the connectors that create and remove
 * people here on their own (D08, ADR-122). One provider, many connectors, so
 * it is a list of its own beside the identity provider's page.
 */
import { useScimHost } from "../../model/scim-host.ts";
import { ScimSettingsContent } from "./scim.screen.tsx";

export default function ConnectorsScreen() {
  const organizationId = useScimHost().organizationId();

  if (!organizationId) return null;

  return (
    <ScimSettingsContent
      organizationId={organizationId}
      title="Connectors"
      lede="Your identity provider creates, updates and removes people here on its own, over SCIM."
    />
  );
}

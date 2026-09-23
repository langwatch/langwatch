// Organization license page for self-hosted operators; licenses are issued in
// the backoffice. No chrome — the settings frame is applied by the host.

import { Heading, Text, VStack } from "@chakra-ui/react";

import { useLicensingHost } from "../../model/licensing-host.ts";
import { LicenseStatusPanel } from "./license-status-panel.tsx";

export default function LicenseScreen() {
  const host = useLicensingHost();
  const organizationId = host.organizationId();

  return (
    <VStack gap={6} width="full" align="start">
      <Heading>License</Heading>
      <Text color="fg.muted">
        Manage your LangWatch license. Running LangWatch, commercially included, never needs one. A
        license covers the seats you bought and unlocks the enterprise capabilities: single sign-on,
        SCIM provisioning and audit logs.
      </Text>
      {organizationId ? (
        <LicenseStatusPanel organizationId={organizationId} />
      ) : (
        <Text>Loading...</Text>
      )}
    </VStack>
  );
}

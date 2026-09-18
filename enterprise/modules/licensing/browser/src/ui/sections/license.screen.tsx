// Organization license page for self-hosted operators; generator only on SaaS.
// No chrome — the settings frame is applied by the host application.

import { Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Plus } from "lucide-react";
import { useState } from "react";

import { useLicensingHost } from "../../model/licensing-host.ts";
import { LicenseStatusPanel } from "./license-status-panel.tsx";

export default function LicenseScreen() {
  const host = useLicensingHost();
  const organizationId = host.organizationId();
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);

  return (
    <VStack gap={6} width="full" align="start">
      <HStack width="full">
        <Heading>License</Heading>
        <Spacer />
        {host.isDeploymentSettled() && host.isSaaS() && (
          <PageLayout.HeaderButton onClick={() => setIsGeneratorOpen(true)}>
            <Plus size={20} />
            New License
          </PageLayout.HeaderButton>
        )}
      </HStack>
      <Text color="fg.muted">
        Manage your LangWatch license. Running LangWatch, commercially included, never needs one. A
        license covers the seats you bought and unlocks the enterprise capabilities: single sign-on,
        SCIM provisioning and audit logs.
      </Text>
      {organizationId ? (
        <LicenseStatusPanel
          organizationId={organizationId}
          isGeneratorOpen={isGeneratorOpen}
          onGeneratorOpenChange={setIsGeneratorOpen}
        />
      ) : (
        <Text>Loading...</Text>
      )}
    </VStack>
  );
}

/**
 * The organization's license, at `/settings/license`.
 *
 * WHAT THIS PAGE IS FOR is a self-hosted operator: running LangWatch
 * commercially never needs a licence, and one covers the seats bought plus the
 * enterprise capabilities — single sign-on, SCIM provisioning and audit logs.
 *
 * THE GENERATOR IS OFFERED ONLY ON THE HOSTED PRODUCT, which is the one thing
 * `isSaaS` decides here. It is deliberately read as a settled pair rather than
 * a bare boolean: while the deployment answer is still arriving, the mint
 * button stays hidden, which is the harmless reading of an unknown.
 *
 * The screen carries no chrome: the settings frame is applied by whichever
 * application serves the address, exactly as `SettingsLayout` was applied by
 * the page file before the move.
 */

import { Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useLicensingHost } from "../../model/licensing-host";
import { LicenseStatusPanel } from "./license-status-panel";

/**
 * The grant this key carries.
 *
 * NONE, one for one with the platform page: `license.tsx` was the only page in
 * the settings family wrapped in no `withPermissionGuard` at all. It is not a
 * hole — `license.getStatus` carries `organization:view` and both writes carry
 * `organization:manage` as their own policy — so a reader without the grant
 * meets a card whose read refused rather than a licence they may not see. The
 * asymmetry is carried rather than tidied, because inventing a guard is a
 * change to who can reach a page and a page move does not own that decision.
 */
export const LICENSE_PAGE_PERMISSION = void 0;

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

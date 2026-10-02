// Organization license page for self-hosted operators; licenses are issued in
// the backoffice. No chrome — the settings frame is applied by the host.

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Link, Text, VStack } from "@langwatch/design-system/primitives";
import { CONTACT_SALES_URL } from "@langwatch/enterprise-licensing-contract";
import { ArrowUpRight } from "lucide-react";

import { useLicensingHost } from "../../model/licensing-host.ts";
import { LicenseLoadingSkeleton } from "../elements/license-loading-skeleton.tsx";
import { LicenseStatusPanel } from "./license-status-panel.tsx";

export default function LicenseScreen() {
  const host = useLicensingHost();
  const organizationId = host.organizationId();

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>License</PageLayout.Heading>
        <PageLayout.HeaderButton primary asChild>
          <Link href={CONTACT_SALES_URL} target="_blank" rel="noreferrer">
            Contact sales
            <ArrowUpRight size={14} />
          </Link>
        </PageLayout.HeaderButton>
      </PageLayout.Header>
      <VStack gap={6} width="full" align="start" paddingTop={4}>
        <Text color="fg.muted">
          What your license covers: the seats you bought and the enterprise capabilities it unlocks,
          such as single sign-on, SCIM provisioning and audit logs. Running LangWatch, commercial
          use included, never needs one.
        </Text>
        {organizationId ? (
          <LicenseStatusPanel organizationId={organizationId} />
        ) : (
          <LicenseLoadingSkeleton />
        )}
      </VStack>
    </>
  );
}

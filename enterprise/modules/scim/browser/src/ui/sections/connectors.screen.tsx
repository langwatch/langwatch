// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * /settings/authentication/connectors: the connectors that create and remove
 * people here on their own (D08, ADR-122). One provider, many connectors, so
 * it is a list of its own beside the identity provider's page.
 */
import { useOptionalUiHostServices } from "@langwatch/browser-host/capabilities";
import { PageLayout, type PageTab } from "@langwatch/design-system/page-layout";
import { Box } from "@langwatch/design-system/primitives";

import { useScimHost } from "../../model/scim-host.ts";
import { ScimSettingsContent } from "./scim.screen.tsx";

/** The three Authentication pages, as header tabs (ARCHITECTURE.md §10). */
const AUTHENTICATION_TABS: readonly PageTab[] = [
  { label: "Overview", href: "/settings/authentication" },
  { label: "Identity provider", href: "/settings/authentication/provider" },
  { label: "Connectors", href: "/settings/authentication/connectors" },
];

export default function ConnectorsScreen() {
  const organizationId = useScimHost().organizationId();
  const navigation = useOptionalUiHostServices()?.navigation;

  if (!organizationId) return null;

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Authentication</PageLayout.Heading>
        <PageLayout.Tabs
          label="Authentication pages"
          tabs={AUTHENTICATION_TABS}
          activeHref="/settings/authentication/connectors"
          onNavigate={(href) => navigation?.navigate(href)}
        />
      </PageLayout.Header>
      <Box paddingTop={4}>
        <ScimSettingsContent
          organizationId={organizationId}
          lede="Your identity provider creates, updates and removes people here on its own, over SCIM."
        />
      </Box>
    </>
  );
}

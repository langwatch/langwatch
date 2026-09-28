// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * /settings/authentication/connectors: the connectors that create and remove
 * people here on their own (D08, ADR-122). One provider, many connectors, so
 * it is a list of its own beside the identity provider's page.
 */
import {
  SectionNavigationFrame,
  type SectionNavigationLink,
} from "@langwatch/design-system/section-navigation-frame";
import { KeyRound, Plug, ShieldCheck } from "lucide-react";

import { useScimHost } from "../../model/scim-host.ts";
import { ScimSettingsContent } from "./scim.screen.tsx";

/** Main's rail across the three Authentication pages (ARCHITECTURE.md §10). */
const AUTHENTICATION_LINKS: readonly SectionNavigationLink[] = [
  { label: "Overview", href: "/settings/authentication", icon: <ShieldCheck size={14} /> },
  {
    label: "Identity provider",
    href: "/settings/authentication/provider",
    icon: <KeyRound size={14} />,
  },
  { label: "Connectors", href: "/settings/authentication/connectors", icon: <Plug size={14} /> },
];

export default function ConnectorsScreen() {
  const organizationId = useScimHost().organizationId();

  if (!organizationId) return null;

  return (
    <SectionNavigationFrame
      label="Authentication"
      links={AUTHENTICATION_LINKS}
      activeHref="/settings/authentication/connectors"
    >
      <ScimSettingsContent
        organizationId={organizationId}
        title="Connectors"
        lede="Your identity provider creates, updates and removes people here on its own, over SCIM."
      />
    </SectionNavigationFrame>
  );
}

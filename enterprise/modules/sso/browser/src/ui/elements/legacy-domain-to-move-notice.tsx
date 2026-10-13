// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The earlier settings' domain still signing in beside the organization's own
 * connection (ADR-124 §7). Nothing is broken; the administrator moves it.
 */
import { Link } from "@langwatch/browser-host/link";
import { Alert, Button } from "@langwatch/design-system/primitives";
import { ExternalLink } from "lucide-react";

export function LegacyDomainToMoveNotice({
  domains,
  settingsHref,
}: {
  domains: readonly string[];
  /** Where the move is made; absent on that page itself. */
  settingsHref?: string;
}) {
  const named = domains.join(", ");

  return (
    <Alert.Root status="info" data-testid="sso-legacy-domain-to-move">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Move {named} onto your connection</Alert.Title>
        <Alert.Description>
          People at {named} still sign in through the single sign-on set up for your organization
          before connections, and keep doing so until you add {named} to your own connection and
          prove it{settingsHref ? "." : " under Domains below."}
        </Alert.Description>
        {settingsHref && (
          <Button asChild size="sm" variant="outline" marginTop={2} alignSelf="start">
            <Link unstyled href={settingsHref} data-testid="sso-legacy-domain-to-move-link">
              <ExternalLink size={14} />
              Open identity provider settings
            </Link>
          </Button>
        )}
      </Alert.Content>
    </Alert.Root>
  );
}

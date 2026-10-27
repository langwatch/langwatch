/**
 * Cloud staff's view of an organization whose earlier single sign-on domain still has to move
 * onto its own connection (ADR-124 §7). Not an upgrade issue: the customer moves it in settings.
 */
import { Link as RoutedLink } from "@langwatch/browser-host/link";
import { Alert, Button } from "@langwatch/design-system/primitives";
import { legacySsoDomainsToMove } from "@langwatch/identity-contract";
import { ExternalLink } from "lucide-react";

import { api } from "../../../../behavior/ops-api.ts";

/** Enough for one organization's connections, which ADR-124 §7 keeps to one or two. */
const CONNECTIONS_PER_ORGANIZATION = 25;

export function LegacySsoDomainNotice({
  organizationId,
  legacySsoDomain,
}: {
  organizationId: string;
  legacySsoDomain: string;
}) {
  const list = api.ssoConnections.getAll.useQuery({
    page: 0,
    pageSize: CONNECTIONS_PER_ORGANIZATION,
    search: organizationId,
  });
  const held = (list.data?.connections ?? []).filter(
    (connection) => connection.organizationId === organizationId,
  );
  const domains = legacySsoDomainsToMove({ legacySsoDomain, connections: held });
  const connection = held.find((candidate) => candidate.source === "self-serve");
  if (domains.length === 0 || !connection) return null;
  const named = domains.join(", ");

  return (
    <Alert.Root status="info" data-testid="ops-legacy-sso-domain-to-move">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{named} still has to move onto its connection</Alert.Title>
        <Alert.Description>
          People at {named} sign in through the earlier single sign-on settings. An administrator of
          this organization moves it by adding {named} to their connection in Settings,
          Authentication, Identity provider.
        </Alert.Description>
        <Button asChild size="sm" variant="outline" marginTop={2} alignSelf="start">
          <RoutedLink
            href={`/ops/sso-connections?connection=${encodeURIComponent(connection.connectionId)}`}
          >
            <ExternalLink size={14} />
            Open its connection
          </RoutedLink>
        </Button>
      </Alert.Content>
    </Alert.Root>
  );
}

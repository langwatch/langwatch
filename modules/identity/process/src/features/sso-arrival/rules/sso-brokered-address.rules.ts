import {
  isConfiguredLegacySsoRoute,
  ssoDomainStanding,
  type SsoConnectionState,
} from "@langwatch/identity-contract";

/** The connection facts both questions below read. */
type AssertingConnection = Pick<
  SsoConnectionState,
  | "verifiedDomains"
  | "domainVerifications"
  | "source"
  | "organizationId"
  | "replacesConnectionId"
  | "state"
  | "idpMetadata"
>;

/** Whether a connection speaks for a domain: proved, or carried by the legacy route's import. */
export function admitsAssertedDomain({
  connection,
  domain,
}: {
  connection: AssertingConnection;
  domain: string;
}): boolean {
  if (ssoDomainStanding({ connection, domain }).proved) return true;
  return (
    isConfiguredLegacySsoRoute({
      source: connection.source,
      providerId: connection.idpMetadata.providerId,
    }) && connection.verifiedDomains.includes(domain)
  );
}

/**
 * Whether a live legacy route's pin names the upstream connection a brokered subject came
 * through (`samlp|acme|alice` under `samlp|acme`). A pin naming only a strategy or the broker
 * itself names no one connection, so it never matches.
 */
export function pinsBrokeredSubject({
  connection,
  subject,
}: {
  connection: AssertingConnection;
  subject: string;
}): boolean {
  const pin = connection.idpMetadata.providerId;
  if (connection.state !== "ACTIVE") return false;
  if (!isConfiguredLegacySsoRoute({ source: connection.source, providerId: pin })) return false;
  return pin.includes("|") && subject.startsWith(`${pin}|`);
}

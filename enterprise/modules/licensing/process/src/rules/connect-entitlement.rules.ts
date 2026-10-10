/**
 * What an install's license says it may call, and what its administrator left
 * switched on. The signed entitlement is what the install may attempt; the
 * registry row the host reads is what succeeds (ADR-156, section 2).
 */

import {
  type ConnectService,
  entitledConnectServices,
} from "@langwatch/enterprise-licensing-contract";

/**
 * The hosted services a validated license names. An unknown name is dropped, so
 * a license minted by a newer release cannot talk this one into calling a route
 * it has no code for.
 */
export function connectServicesNamedBy(named: readonly string[] | undefined): ConnectService[] {
  return entitledConnectServices(named ?? []);
}

/** The entitled services, less the ones an administrator switched off. */
export function enabledConnectServices({
  entitled,
  disabled,
}: {
  entitled: readonly ConnectService[];
  disabled: readonly string[];
}): ConnectService[] {
  const refused = new Set(disabled);
  return entitled.filter((service) => !refused.has(service));
}

/**
 * What the switch column becomes after one change. It records refusals, so
 * switching a service on removes a name rather than adding one and an entitled
 * service needs no row at all.
 */
export function connectServicesDisabledAfter({
  current,
  service,
  enabled,
}: {
  current: readonly string[];
  service: string;
  enabled: boolean;
}): string[] {
  return enabled ? current.filter((name) => name !== service) : [...new Set([...current, service])];
}

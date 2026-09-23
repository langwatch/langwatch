// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The hosted services a license can be entitled to, named the way the license
 * registry, the install's opt-in and the hosted routes all name them (ADR-156).
 */
export const CONNECT_SERVICES = ["instant_evals", "managed_models"] as const;

export type ConnectService = (typeof CONNECT_SERVICES)[number];

/** The services an answer may name, which are the ones an install knows. */
export function entitledConnectServices(services: readonly string[]): ConnectService[] {
  return services.filter((service): service is ConnectService =>
    (CONNECT_SERVICES as readonly string[]).includes(service),
  );
}

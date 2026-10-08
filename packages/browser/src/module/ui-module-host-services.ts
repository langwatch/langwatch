/**
 * Each host service resolved to its one installed provider, refused at install when none or
 * two provide it. ARCHITECTURE.md §10.1 "A host service is provided by its owner".
 */

import type { HostServiceIdentity } from "@langwatch/browser-host/declarations";

import type { SupplyModule } from "../web-module.ts";

/** The host services the runtime resolves, in the order it runs them. None has landed yet. */
export const UI_HOST_SERVICES: readonly HostServiceIdentity[] = [];

export class BrowserHostServiceRefusedError extends Error {
  readonly code = "browser_host_service_refused";

  constructor(readonly refusals: readonly string[]) {
    super(refusals.join("\n"));
    this.name = "BrowserHostServiceRefusedError";
  }
}

/** One host service and the installed module that provides it. */
export type UiHostServiceProvider = Readonly<{
  service: string;
  module: string;
  load: () => Promise<unknown>;
}>;

type ResolveInput = Readonly<{
  modules: readonly SupplyModule[];
  services: readonly HostServiceIdentity[];
}>;

/** Every refusal, naming the service and each provider; never only the first. */
export function findHostServiceRefusals({ modules, services }: ResolveInput): readonly string[] {
  const providers = providersByService({ modules });
  const refusals: string[] = [];
  for (const [service, provided] of providers) {
    if (provided.length < 2) continue;
    const names = provided.map(({ module }) => JSON.stringify(module)).join(" and ");
    refusals.push(`Host service ${JSON.stringify(service)} is provided by both ${names}.`);
  }
  for (const { name } of services) {
    if (!providers.has(name)) {
      refusals.push(`Host service ${JSON.stringify(name)} has no installed provider.`);
    }
  }
  return refusals;
}

/** Refuses by name at install, before render. */
export function checkHostServices(input: ResolveInput): void {
  const refusals = findHostServiceRefusals(input);
  if (refusals.length > 0) throw new BrowserHostServiceRefusedError(refusals);
}

/** Each service's one provider, in the runtime's order, not install order. */
export function resolveHostServices(input: ResolveInput): readonly UiHostServiceProvider[] {
  checkHostServices(input);
  const providers = providersByService({ modules: input.modules });
  return input.services.flatMap(({ name }) => providers.get(name) ?? []);
}

function providersByService({
  modules,
}: Pick<ResolveInput, "modules">): ReadonlyMap<string, readonly UiHostServiceProvider[]> {
  const providers = new Map<string, readonly UiHostServiceProvider[]>();
  for (const module of modules) {
    for (const { service, load } of module.installation.provides ?? []) {
      const provider = { service: service.name, module: module.name, load };
      providers.set(service.name, [...(providers.get(service.name) ?? []), provider]);
    }
  }
  return providers;
}

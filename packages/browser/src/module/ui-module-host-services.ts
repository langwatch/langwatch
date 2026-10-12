/**
 * Each host service resolved to its one installed provider, refused at install when none or
 * two provide it. ARCHITECTURE.md §10.1 "A host service is provided by its owner".
 */

import type {
  UiHostServiceInput,
  UiHostServiceSource,
  UiHostServiceValues,
} from "@langwatch/browser-host/capabilities";
import type { HostServiceIdentity } from "@langwatch/browser-host/declarations";
import { UiFlagsService } from "@langwatch/browser-host/feature-flag";

import type { SupplyModule } from "../web-module.ts";

/** The host services the runtime resolves, in the order it runs them. */
export const UI_HOST_SERVICES: readonly HostServiceIdentity[] = [UiFlagsService];

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
  load: () => Promise<{ readonly default: UiHostServiceSource<unknown> }>;
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

/** One resolved service and its loaded source, as the runtime runs it. */
export type UiHostServiceRun = Readonly<{
  service: string;
  source: UiHostServiceSource<unknown>;
}>;

/** Each service's source loaded before render, in the runtime's order. */
export async function loadHostServices(input: ResolveInput): Promise<readonly UiHostServiceRun[]> {
  return Promise.all(
    resolveHostServices(input).map(async ({ service, load }) => ({
      service,
      source: (await load()).default,
    })),
  );
}

/** Calls each source as a hook with the one shared input, in order; the values keyed by service. */
export function runHostServices({
  sources,
  input,
}: {
  sources: readonly UiHostServiceRun[];
  input: UiHostServiceInput;
}): UiHostServiceValues {
  return new Map(sources.map(({ service, source }) => [service, source(input)]));
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

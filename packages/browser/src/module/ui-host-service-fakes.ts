/**
 * Test compositions install this beside the module under test: a fake for every host
 * service in UI_HOST_SERVICES, so `createUi` finds a provider without another module's browser.
 */

import type { UiFlags } from "@langwatch/browser-host/feature-flag";
import { UiFlagsService } from "@langwatch/browser-host/feature-flag";

import { defineBrowserModule } from "../web-module.ts";

type HostServiceFakesInput = Readonly<{
  /** Flag name to answer; every other flag reads not yet answered. */
  flags?: Readonly<Record<string, boolean>>;
}>;

/** One browser module providing a fake of each listed host service. */
export function hostServiceFakes({ flags = {} }: HostServiceFakesInput = {}) {
  const uiFlags: UiFlags = { flag: (token) => flags[token.name] };
  return defineBrowserModule("host-service-fakes").provides(UiFlagsService, {
    load: () => Promise.resolve({ default: () => uiFlags }),
  });
}

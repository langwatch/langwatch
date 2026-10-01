/**
 * A screen declares the `*HostApi` it reads; a module mounts one for itself
 * or a peer. This walks the declarations only, so the refusal fires at
 * install, before render (ARCHITECTURE.md §10.1).
 */

import type { SupplyModule, WebHostMount } from "./web-module.ts";

/** One module still owed a mount for a host it declared it reads. */
export type UnmountedHostOwner = Readonly<{ module: string; host: string }>;

/**
 * Every `{ module, host }` where `module` requires `host` and neither an
 * installed module nor `mountedByShell` mounts it. Collects every offender
 * rather than stopping at the first.
 */
export function findUnmountedHostOwners({
  modules,
  mountedByShell = [],
}: {
  modules: readonly SupplyModule[];
  mountedByShell?: readonly string[];
}): readonly UnmountedHostOwner[] {
  const mounted = new Set<string>(mountedByShell);
  for (const installed of modules) {
    for (const host of Object.keys(installed.installation.hosts.mounts)) mounted.add(host);
  }

  const owners: UnmountedHostOwner[] = [];
  for (const installed of modules) {
    for (const host of installed.installation.hosts.requires) {
      if (!mounted.has(host)) owners.push({ module: installed.name, host });
    }
  }
  return owners;
}

export class BrowserHostUnmountedError extends Error {
  readonly code = "browser_host_unmounted";

  constructor(readonly owners: readonly UnmountedHostOwner[]) {
    super(
      owners
        .map(
          ({ module, host }) =>
            `Module ${JSON.stringify(module)} declares ${host} and nothing mounts it.`,
        )
        .join("\n"),
    );
    this.name = "BrowserHostUnmountedError";
  }
}

/** Refuses by name, naming every owing module — never only the first. */
export function checkHostMounts({
  modules,
  mountedByShell = [],
}: {
  modules: readonly SupplyModule[];
  mountedByShell?: readonly string[];
}): void {
  const owners = findUnmountedHostOwners({ modules, mountedByShell });
  if (owners.length > 0) throw new BrowserHostUnmountedError(owners);
  const unrequired = findUnrequiredHostMounts({ modules });
  if (unrequired.length > 0) throw new BrowserHostUnrequiredError(unrequired);
}

/** One module mounting a host name no installed module reads. */
export type UnrequiredHostMount = Readonly<{ module: string; host: string }>;

/**
 * Both halves are free strings, so `requires: "WorkflowHostApi"` against
 * `mounts: { WorkflowHost }` passes the check above with the screen still
 * crashing. Reading the seam from the mount side names the typo instead.
 */
export function findUnrequiredHostMounts({
  modules,
}: {
  modules: readonly SupplyModule[];
}): readonly UnrequiredHostMount[] {
  const required = new Set<string>();
  for (const installed of modules) {
    for (const host of installed.installation.hosts.requires) required.add(host);
  }

  const unrequired: UnrequiredHostMount[] = [];
  for (const installed of modules) {
    for (const host of Object.keys(installed.installation.hosts.mounts)) {
      if (!required.has(host)) unrequired.push({ module: installed.name, host });
    }
  }
  return unrequired;
}

export class BrowserHostUnrequiredError extends Error {
  readonly code = "browser_host_unrequired";

  constructor(readonly mounts: readonly UnrequiredHostMount[]) {
    super(
      mounts
        .map(
          ({ module, host }) =>
            `Module ${JSON.stringify(module)} mounts ${host} and no installed module declares it.`,
        )
        .join("\n"),
    );
    this.name = "BrowserHostUnrequiredError";
  }
}

/** One declared mount, as the shell composes it: named, ordered, loadable. */
export type UiModuleHostMount = Readonly<{
  module: string;
  host: string;
  load: WebHostMount["load"];
}>;

/**
 * Every installed module's host mounts, in install order. The shell renders
 * them around the routed tree, so a host a PEER's screens require is answered
 * too — `requires` is per module, but a mount is above all of them.
 */
export function installedModuleHostMounts(
  modules: readonly SupplyModule[],
): readonly UiModuleHostMount[] {
  return modules.flatMap((module) =>
    Object.entries(module.installation.hosts.mounts).map(([host, mount]) => ({
      module: module.name,
      host,
      load: mount.load,
    })),
  );
}

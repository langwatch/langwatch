/**
 * The drawer names the mounted registry declares, so a name no installed module declared is
 * refused by name (ADR-148 §8; specs/ui/declared-browser-supply.feature). Registries are held
 * the way `drawer-router.ts` holds mounted routers; with none mounted, nothing is judged.
 */

export class BrowserDrawerUndeclaredError extends Error {
  readonly code = "browser_drawer_undeclared";

  constructor(readonly drawer: string) {
    super(`Drawer ${JSON.stringify(drawer)} is not declared by any installed module.`);
    this.name = "BrowserDrawerUndeclaredError";
  }
}

const mountedRegistries = new Set<Readonly<Record<string, unknown>>>();

/** Mounts a composed registry's names; the returned call takes only this one back. */
export function declareDrawers(drawers: Readonly<Record<string, unknown>>): () => void {
  mountedRegistries.add(drawers);
  return () => {
    mountedRegistries.delete(drawers);
  };
}

/** Whether `drawer` is a name the registry declares, never an inherited object key. */
export function isDeclaredDrawer({
  drawers,
  drawer,
}: {
  drawers: Readonly<Record<string, unknown>>;
  drawer: string;
}): boolean {
  return Object.hasOwn(drawers, drawer);
}

/** Throws the named refusal when a registry is mounted and none of them declares `drawer`. */
export function refuseUndeclaredDrawer(drawer: string): void {
  if (mountedRegistries.size === 0) return;
  for (const drawers of mountedRegistries) {
    if (isDeclaredDrawer({ drawers, drawer })) return;
  }
  throw new BrowserDrawerUndeclaredError(drawer);
}

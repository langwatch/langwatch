/**
 * One address, one screen: two installed modules whose screens declare the same path are
 * refused at boot, naming both and the address. Parameter names do not tell routes apart.
 * ADR-148 §8 (`browser_page_claimed_twice`); specs/ui/declared-browser-supply.feature.
 */

import type { SupplyModule } from "../web-module.ts";

export class BrowserPageClaimedTwiceError extends Error {
  readonly code = "browser_page_claimed_twice";

  constructor(readonly refusals: readonly string[]) {
    super(refusals.join("\n"));
    this.name = "BrowserPageClaimedTwiceError";
  }
}

/** `/:project/traces/` and `/:projectSlug/traces` match the same addresses. */
function routeShapeOf({ path }: { path: string }): string {
  const shaped = path.replace(/:[^/]+/g, ":").replace(/\/+$/, "");
  return shaped === "" ? "/" : shaped;
}

/** Every address two modules claim, naming both; never only the first. */
export function findClaimedTwice({
  modules,
}: {
  modules: readonly SupplyModule[];
}): readonly string[] {
  const refusals: string[] = [];
  const claims = new Map<string, Readonly<{ module: string; path: string }>>();

  for (const module of modules) {
    for (const screen of Object.values(module.installation.screens)) {
      if (screen.path === void 0) continue;
      const shape = routeShapeOf({ path: screen.path });
      const first = claims.get(shape);
      if (first === void 0) {
        claims.set(shape, { module: module.name, path: screen.path });
        continue;
      }
      if (first.module === module.name) continue;
      refusals.push(
        `Address ${JSON.stringify(screen.path)} is declared by both ${JSON.stringify(first.module)} and ${JSON.stringify(module.name)}.`,
      );
    }
  }

  return refusals;
}

export function checkScreenAddresses({ modules }: { modules: readonly SupplyModule[] }): void {
  const refusals = findClaimedTwice({ modules });
  if (refusals.length > 0) throw new BrowserPageClaimedTwiceError(refusals);
}

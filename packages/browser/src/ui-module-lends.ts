/**
 * What modules lend or register by token, checked at install: only a token's
 * owner lends it (an extension token is any module's), and one lender each.
 * The runtime twin of the compile-time check in `.lends` and `.drawer`.
 */

import type { SupplyModule } from "./web-module.ts";

export class BrowserLendRefusedError extends Error {
  readonly code = "browser_lend_refused";

  constructor(readonly refusals: readonly string[]) {
    super(refusals.join("\n"));
    this.name = "BrowserLendRefusedError";
  }
}

/** Every refusal, in module order, naming both parties; never only the first. */
export function findLendRefusals({
  modules,
}: {
  modules: readonly SupplyModule[];
}): readonly string[] {
  const refusals: string[] = [];
  const lenders = new Map<string, string>();

  for (const module of modules) {
    for (const { token } of module.installation.lends) {
      if (token.kind === "extension") continue;
      if (token.owner !== module.name) {
        refusals.push(
          `Module ${JSON.stringify(module.name)} lends ${JSON.stringify(token.key)}, which ${JSON.stringify(token.owner)} owns.`,
        );
        continue;
      }
      const first = lenders.get(token.key);
      if (first !== void 0) {
        refusals.push(
          `Token ${JSON.stringify(token.key)} is lent by both ${JSON.stringify(first)} and ${JSON.stringify(module.name)}.`,
        );
        continue;
      }
      lenders.set(token.key, module.name);
    }
  }

  return refusals;
}

/** Refuses by name at install, before render. */
export function checkLends({ modules }: { modules: readonly SupplyModule[] }): void {
  const refusals = findLendRefusals({ modules });
  if (refusals.length > 0) throw new BrowserLendRefusedError(refusals);
}

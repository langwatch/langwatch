/**
 * What installed modules lent by token, read in install order, so a module's own
 * host can hand a peer's lent component to its screens. ARCHITECTURE.md §10.1.
 */

import type { UiTokenIdentity } from "@langwatch/module";

/** An installed module as this reader sees it: what it installed, and what it lends by token. */
export type UiDeclaringModule = {
  readonly name: string;
  readonly installation: {
    readonly capabilities: Readonly<Record<string, unknown>>;
    readonly lends?: readonly UiLend[];
  };
};

/**
 * What a module lent under a token: a chunk to load, or an eager value.
 * The owner's `.lends` wrote the same payload under the legacy name too.
 */
export type UiLend = Readonly<{ token: UiTokenIdentity }> &
  (Readonly<{ load: () => Promise<unknown> }> | Readonly<{ value: unknown }>);

/** One lend, with the module that made it. */
export type UiLentBy = Readonly<{ module: string; lend: UiLend }>;

export type {
  ReleaseFlagToken,
  UiComponentToken,
  UiDrawerToken,
  UiExtensionToken,
  UiHooksToken,
  UiOperationsToken,
  UiTokenIdentity,
} from "@langwatch/module";

/** The declarations above this screen. Nothing declared reads as an empty list. */
export abstract class UiDeclarations {
  /** Every lend under this token's key, in install order. */
  lent(_token: UiTokenIdentity): readonly UiLentBy[] {
    return [];
  }
}

class InstalledUiDeclarations extends UiDeclarations {
  constructor(private readonly modules: readonly UiDeclaringModule[]) {
    super();
  }

  override lent(token: UiTokenIdentity): readonly UiLentBy[] {
    return this.modules.flatMap((module) =>
      (module.installation.lends ?? [])
        .filter((lend) => lend.token.key === token.key)
        .map((lend) => ({ module: module.name, lend })),
    );
  }
}

/** What a composition installs: every installed module, in install order. */
export function uiDeclarations(modules: readonly UiDeclaringModule[]): UiDeclarations {
  return new InstalledUiDeclarations(modules);
}

/** A composition that installed no declarations. */
export const NO_UI_DECLARATIONS: UiDeclarations = uiDeclarations([]);

/**
 * A service browser-host declares and exactly one installed module provides with
 * `.provides(Service, { load })`; `createUi` resolves it. ARCHITECTURE.md §10.1.
 */
export type HostServiceIdentity = Readonly<{ name: string }>;

/** The source's type rides on the service, so `.provides` checks the chunk against it. */
export class HostService<Source> {
  declare private readonly source: (value: Source) => Source;

  constructor(readonly name: string) {
    Object.freeze(this);
  }
}

export function hostService<Source>(name: string): HostService<Source> {
  return new HostService<Source>(name);
}

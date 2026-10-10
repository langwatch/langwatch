import type { ModuleName } from "../module-namespace.ts";

export type UiTokenKind = "component" | "operations" | "hooks" | "extension" | "drawer";

export abstract class UiTokenIdentity {
  protected constructor(
    readonly kind: UiTokenKind,
    readonly owner: ModuleName,
    readonly name: string,
  ) {}

  /** The registry key: a drawer keeps its wire name, the rest are owner-scoped. */
  get key(): string {
    return this.kind === "drawer" ? this.name : `${this.owner}.${this.name}`;
  }
}

/**
 * Runtime identity and one compile-time shape for a name another module
 * depends on. ARCHITECTURE.md 10.1: a name another module reads is a token
 * its owner declares.
 */
export class UiToken<
  Kind extends UiTokenKind,
  Shape,
  Owner extends ModuleName = ModuleName,
> extends UiTokenIdentity {
  declare readonly kind: Kind;
  declare readonly owner: Owner;
  declare private readonly shape: (value: Shape) => Shape;

  private constructor(kind: Kind, owner: Owner, name: string) {
    super(kind, owner, name);
  }

  static create<Kind extends UiTokenKind, Shape, Owner extends ModuleName>(
    kind: Kind,
    owner: Owner,
    name: string,
  ): UiToken<Kind, Shape, Owner> {
    const token = new UiToken<Kind, Shape, Owner>(kind, owner, name);
    Object.freeze(token);
    return token;
  }
}

export type UiComponentToken<Props, Owner extends ModuleName = ModuleName> = UiToken<
  "component",
  Props,
  Owner
>;
export type UiExtensionToken<Props, Owner extends ModuleName = ModuleName> = UiToken<
  "extension",
  Props,
  Owner
>;
export type UiOperationsToken<Operations, Owner extends ModuleName = ModuleName> = UiToken<
  "operations",
  Operations,
  Owner
>;
export type UiHooksToken<Hooks, Owner extends ModuleName = ModuleName> = UiToken<
  "hooks",
  Hooks,
  Owner
>;
export type UiDrawerToken<Props, Owner extends ModuleName = ModuleName> = UiToken<
  "drawer",
  Props,
  Owner
>;

/** The owner's way to mint tokens: the owner literal is kept, the shape is explicit. */
export function uiTokens<const Owner extends ModuleName>(owner: Owner) {
  return {
    component: <Props>(name: string) =>
      UiToken.create<"component", Props, Owner>("component", owner, name),
    extension: <Props>(name: string) =>
      UiToken.create<"extension", Props, Owner>("extension", owner, name),
    operations: <Operations>(name: string) =>
      UiToken.create<"operations", Operations, Owner>("operations", owner, name),
    hooks: <Hooks>(name: string) => UiToken.create<"hooks", Hooks, Owner>("hooks", owner, name),
    drawer: <Props>(name: string) => UiToken.create<"drawer", Props, Owner>("drawer", owner, name),
  };
}

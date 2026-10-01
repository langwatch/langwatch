import type { CacheDeclaringContract } from "@langwatch/browser-host/cache-tiers";
import type {
  ReleaseFlagToken,
  UiComponentToken,
  UiDrawerToken,
  UiExtensionToken,
  UiHooksToken,
  UiLend,
  UiOperationsToken,
  UiTokenIdentity,
} from "@langwatch/browser-host/declarations";
import type { DrawersDifferingFromMap } from "@langwatch/browser-host/drawer";
import type { ComponentType } from "react";
import type { output, ZodType } from "zod";

import type { Merge } from "./ui-supply.types.ts";

type Empty = Record<never, never>;

export type UiSupplyName =
  | "injected-config"
  | "transport"
  | "session"
  | "feedback"
  | "storage"
  | "document-title"
  | "analytics"
  | "toaster"
  | "graphics-quality"
  | "boot-refusal";

export type UiFacilityName = "feedback" | "storage" | "document-title" | "analytics";
export type UiShellName = "toaster" | "graphics-quality" | "boot-refusal";
export type UiSupplyRequirements = Readonly<Partial<Record<UiSupplyName, unknown>>>;

export type WebScreenRoute = Readonly<{
  path?: string;
  instance?: string;
  layouts?: readonly string[];
}>;

export type WebScreen = Readonly<{
  path?: string;
  routes?: readonly WebScreenRoute[];
  within?: string | null;
  shell?: string;
  label?: string;
  icon?: unknown;
  load?: () => Promise<unknown>;
  /** The grant the shell's router checks before this screen renders (§10). */
  requires?: string;
  /** Release flags that must all be on for this screen to exist; off answers not-found. */
  flags?: readonly (string | ReleaseFlagToken)[];
}>;

export type WebScreens = Readonly<Record<string, WebScreen>>;

/**
 * One URL-routed drawer, named by the key the address bar carries
 * (`?drawer.open=<key>`). `load` resolves the component, as a screen's does.
 */
export type WebDrawer = Readonly<{
  load: () => Promise<unknown>;
}>;

export type WebDrawers = Readonly<Record<string, WebDrawer>>;

/** A chunk a token's owner lends, whose default export is the token's shape. */
type Loaded<Shape> = () => Promise<{ readonly default: Shape }>;

/** Only the module the token names lends it; an extension token is any module's. */
type OwnedBy<Token, Name extends string> = Token & { readonly owner: Name };

/** What a module's capability implementation is, as the composition receives it. */
export type WebCapabilities = Readonly<Record<string, unknown>>;

/**
 * One host mount: a provider component that renders its `*HostProvider` around
 * `UiRouteOutlet`, as a screen's `load` resolves a page. ARCHITECTURE.md §10.1.
 */
export type WebHostMount = Readonly<{
  load: () => Promise<unknown>;
}>;

/**
 * A screen's `*HostApi` dependency (`requires`), and this module's own or a
 * peer's mount that answers it, keyed by host name. ARCHITECTURE.md §10.1.
 */
export type WebHostDeclaration = Readonly<{
  requires: readonly string[];
  mounts: Readonly<Record<string, WebHostMount>>;
}>;

type WebModuleDeclaration = Readonly<{
  screens: WebScreens;
  drawers: WebDrawers;
  mounts: readonly string[];
  hosts: WebHostDeclaration;
  capabilities: WebCapabilities;
}>;

type EmptyDeclaration = Readonly<{
  screens: Empty;
  drawers: Empty;
  mounts: readonly [];
  hosts: Readonly<{ requires: readonly []; mounts: Empty }>;
  capabilities: Empty;
}>;

/** The page's config slices a module reads, each by its owner's name and that owner's schema. */
export type WebModuleConfig = Readonly<{ slices: Readonly<Record<string, ZodType>> }>;

export type WebModuleInstallation = Readonly<{
  name: string;
  requirements: readonly UiSupplyName[];
  config?: WebModuleConfig;
  screens: WebScreens;
  drawers: WebDrawers;
  mounts: readonly string[];
  hosts: WebHostDeclaration;
  capabilities: WebCapabilities;
  /** What this module lends or registers by token, in declaration order. */
  lends: readonly UiLend[];
  api?: unknown;
  /** The contracts whose cache policies the api's reads follow. */
  apiContracts?: readonly CacheDeclaringContract[];
  failureInterceptors: readonly unknown[];
}>;

type RequirementFields<Names extends UiSupplyName> = Readonly<{
  [Name in Names]: unknown;
}>;
type IfPresent<Value, Present, Absent = Empty> = [Value] extends [never] ? Absent : Present;
type RecordKeys<Value extends object> = keyof Value & string;
type ScreenRequirements<Screens extends WebScreens> = IfPresent<
  RecordKeys<Screens>,
  RequirementFields<"transport">
>;
type CheckedLiteralTuple<Values extends readonly string[]> = number extends Values["length"]
  ? never
  : string extends Values[number]
    ? never
    : unknown;
type CheckedKeyedRecord<Value extends object> = string extends keyof Value ? never : unknown;

declare const webModuleState: unique symbol;

export class WebModule<
  Name extends string = string,
  Requirements extends object = UiSupplyRequirements,
  Config extends object = Readonly<Record<string, unknown>>,
  Declaration extends WebModuleDeclaration = WebModuleDeclaration,
  Precise extends boolean = boolean,
> {
  declare readonly [webModuleState]: void;
  declare readonly types: Readonly<{
    name: Name;
    requirements: Requirements;
    config: Config;
    declaration: Declaration;
    precise: Precise;
  }>;

  readonly name: Name;
  readonly #installation: WebModuleInstallation;

  private constructor(name: Name, installation: WebModuleInstallation) {
    this.name = name;
    this.#installation = installation;
  }

  static create<const Name extends string>(
    name: Name,
  ): WebModule<Name, Empty, Empty, EmptyDeclaration, true> {
    return new WebModule(name, {
      name,
      requirements: [],
      screens: {},
      drawers: {},
      mounts: [],
      hosts: { requires: [], mounts: {} },
      capabilities: {},
      lends: [],
      failureInterceptors: [],
    });
  }

  /**
   * Sound: only `withCapabilities` writes the wide store and the precise
   * `Declaration`, in one call, so they cannot drift. ADR-140.
   */
  get installation(): Omit<WebModuleInstallation, "capabilities"> &
    Readonly<{ capabilities: Declaration["capabilities"] }> {
    return this.#installation as Omit<WebModuleInstallation, "capabilities"> &
      Readonly<{ capabilities: Declaration["capabilities"] }>;
  }

  requires<const Names extends readonly UiSupplyName[]>(
    names: Names,
    ..._checked: [CheckedLiteralTuple<Names>] extends [never] ? [never] : []
  ): WebModule<
    Name,
    Merge<Requirements, RequirementFields<Names[number]>>,
    Config,
    Declaration,
    Precise
  > {
    return this.#next({
      ...this.#installation,
      requirements: mergeNames(this.#installation.requirements, names),
    });
  }

  withScreens<const Screens extends WebScreens>(
    screens: Screens,
    ..._checked: [CheckedKeyedRecord<Screens>] extends [never] ? [never] : []
  ): WebModule<
    Name,
    Merge<Requirements, ScreenRequirements<Screens>>,
    Config,
    Merge<Declaration, { readonly screens: Screens }>,
    Precise
  > {
    const requirements: readonly UiSupplyName[] =
      Object.keys(screens).length === 0
        ? this.#installation.requirements
        : mergeNames(this.#installation.requirements, ["transport"]);
    return this.#next({ ...this.#installation, requirements, screens });
  }

  withDrawers<const Drawers extends WebDrawers>(
    drawers: Drawers,
    ..._checked: [CheckedKeyedRecord<Drawers>] extends [never]
      ? [never]
      : [DrawersDifferingFromMap<Drawers>] extends [never]
        ? []
        : [drawerPropsDifferFromTheMap: DrawersDifferingFromMap<Drawers>]
  ): WebModule<
    Name,
    Requirements,
    Config,
    Merge<Declaration, { readonly drawers: Drawers }>,
    Precise
  > {
    return this.#next({
      ...this.#installation,
      drawers: { ...this.#installation.drawers, ...drawers },
    });
  }

  /**
   * Lends to peers by token: a component, operations or hooks token this module owns, or any
   * module's extension token. The default is checked against the token's shape and, until the
   * string path goes, also declared under the token's name for `declared(name)`.
   */
  lends<Props>(
    token: OwnedBy<UiComponentToken<Props>, Name> | UiExtensionToken<Props>,
    source: { load: Loaded<ComponentType<Props>> },
  ): WebModule<Name, Requirements, Config, Declaration, Precise>;
  lends<Operations>(
    token: OwnedBy<UiOperationsToken<Operations>, Name>,
    source: { load: Loaded<Operations> },
  ): WebModule<Name, Requirements, Config, Declaration, Precise>;
  lends<Hooks>(
    token: OwnedBy<UiHooksToken<Hooks>, Name>,
    source: { value: Hooks },
  ): WebModule<Name, Requirements, Config, Declaration, Precise>;
  lends(
    token: UiTokenIdentity,
    source: { load: () => Promise<unknown> } | { value: unknown },
  ): WebModule<Name, Requirements, Config, Declaration, Precise> {
    const legacy = "load" in source ? { load: source.load } : source.value;
    return this.#next({
      ...this.#installation,
      lends: [...this.#installation.lends, { token, ...source }],
      capabilities: { ...this.#installation.capabilities, [token.name]: legacy },
    });
  }

  /** Registers a drawer this module owns, under the wire name its token carries. */
  drawer<Props>(
    token: OwnedBy<UiDrawerToken<Props>, Name>,
    source: { load: Loaded<ComponentType<Props>> },
  ): WebModule<Name, Requirements, Config, Declaration, Precise> {
    return this.#next({
      ...this.#installation,
      drawers: { ...this.#installation.drawers, [token.key]: source },
      lends: [...this.#installation.lends, { token, load: source.load }],
    });
  }

  withCapabilities<const Capabilities extends WebCapabilities>(
    capabilities: Capabilities,
  ): WebModule<
    Name,
    Requirements,
    Config,
    Merge<Declaration, { readonly capabilities: Capabilities }>,
    Precise
  > {
    return this.#next({
      ...this.#installation,
      capabilities: { ...this.#installation.capabilities, ...capabilities },
    });
  }

  withApi<Api>(
    api: Api,
    options: { contracts?: readonly CacheDeclaringContract[] } = {},
  ): WebModule<
    Name,
    Merge<Requirements, RequirementFields<"transport">>,
    Config,
    Declaration,
    Precise
  > {
    return this.#next({
      ...this.#installation,
      api,
      ...(options.contracts ? { apiContracts: options.contracts } : {}),
      requirements: mergeNames(this.#installation.requirements, ["transport"]),
    });
  }

  /**
   * The `*HostApi` names this module reads (`requires`) and mounts, for
   * itself or a peer (`mounts`). `createUi` refuses an unmet `requires`.
   */
  withHosts(
    hosts: Partial<WebHostDeclaration>,
  ): WebModule<
    Name,
    Requirements,
    Config,
    Merge<Declaration, { readonly hosts: WebHostDeclaration }>,
    Precise
  > {
    return this.#next({
      ...this.#installation,
      hosts: { requires: hosts.requires ?? [], mounts: hosts.mounts ?? {} },
    });
  }

  withConfig<const Slices extends Readonly<Record<string, ZodType>>>(
    slices: Slices,
  ): WebModule<
    Name,
    Merge<Requirements, RequirementFields<"injected-config">>,
    Merge<
      Config,
      { readonly [Key in Name]: { readonly [Owner in keyof Slices]: output<Slices[Owner]> } }
    >,
    Declaration,
    Precise
  > {
    return this.#next({
      ...this.#installation,
      config: { slices },
      requirements: mergeNames(this.#installation.requirements, ["injected-config"]),
    });
  }

  mountSurfaces<const Mounts extends readonly string[]>(
    mounts: Mounts,
    ..._checked: [CheckedLiteralTuple<Mounts>] extends [never] ? [never] : []
  ): WebModule<
    Name,
    Requirements,
    Config,
    Merge<Declaration, { readonly mounts: Mounts }>,
    Precise
  > {
    return this.#next({ ...this.#installation, mounts });
  }

  withFailureInterceptors<const Interceptors extends readonly unknown[]>(
    failureInterceptors: Interceptors,
  ): WebModule<
    Name,
    Merge<Requirements, RequirementFields<"feedback">>,
    Config,
    Declaration,
    Precise
  > {
    return this.#next({
      ...this.#installation,
      failureInterceptors,
      requirements: mergeNames(this.#installation.requirements, ["feedback"]),
    });
  }

  #next<
    NextRequirements extends object,
    NextConfig extends object,
    NextDeclaration extends WebModuleDeclaration,
  >(
    installation: WebModuleInstallation,
  ): WebModule<Name, NextRequirements, NextConfig, NextDeclaration, Precise> {
    return new WebModule<Name, NextRequirements, NextConfig, NextDeclaration, Precise>(
      this.name,
      installation,
    );
  }
}

export type SupplyModule = WebModule<
  string,
  UiSupplyRequirements,
  Readonly<Record<string, unknown>>,
  WebModuleDeclaration,
  boolean
>;

export function defineWebModule<const Name extends string>(
  name: Name,
): WebModule<Name, Empty, Empty, EmptyDeclaration, true> {
  return WebModule.create(name);
}

function mergeNames(
  current: readonly UiSupplyName[],
  next: readonly UiSupplyName[],
): readonly UiSupplyName[] {
  return [...new Set([...current, ...next])];
}

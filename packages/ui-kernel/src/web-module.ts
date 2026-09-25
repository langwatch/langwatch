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
export type WebSurfacePublication = Readonly<{
  load: () => Promise<unknown>;
  provider?: unknown;
  order?: number;
}>;
export type WebSurfacePublications = Readonly<Record<string, WebSurfacePublication>>;

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
  publications: WebSurfacePublications;
  mounts: readonly string[];
  hosts: WebHostDeclaration;
  capabilities: WebCapabilities;
}>;

type EmptyDeclaration = Readonly<{
  screens: Empty;
  drawers: Empty;
  publications: Empty;
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
  publications: WebSurfacePublications;
  mounts: readonly string[];
  hosts: WebHostDeclaration;
  capabilities: WebCapabilities;
  api?: unknown;
  slots: readonly string[];
  seatTypeCopy: boolean;
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
      publications: {},
      mounts: [],
      hosts: { requires: [], mounts: {} },
      capabilities: {},
      slots: [],
      seatTypeCopy: false,
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
    ..._checked: [CheckedKeyedRecord<Drawers>] extends [never] ? [never] : []
  ): WebModule<
    Name,
    Requirements,
    Config,
    Merge<Declaration, { readonly drawers: Drawers }>,
    Precise
  > {
    return this.#next({ ...this.#installation, drawers });
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
    return this.#next({ ...this.#installation, capabilities });
  }

  withApi<Api>(
    api: Api,
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

  publishSurfaces<const Publications extends WebSurfacePublications>(
    publications: Publications,
    ..._checked: [CheckedKeyedRecord<Publications>] extends [never] ? [never] : []
  ): WebModule<
    Name,
    Requirements,
    Config,
    Merge<Declaration, { readonly publications: Publications }>,
    Precise
  > {
    return this.#next({ ...this.#installation, publications });
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

  withSlots<const Slots extends readonly string[]>(
    slots: Slots,
    ..._checked: [CheckedLiteralTuple<Slots>] extends [never] ? [never] : []
  ): WebModule<Name, Requirements, Config, Declaration, Precise> {
    return this.#next({ ...this.#installation, slots });
  }

  withSeatTypeCopy(): WebModule<Name, Requirements, Config, Declaration, Precise> {
    return this.#next({ ...this.#installation, seatTypeCopy: true });
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

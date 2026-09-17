import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import type { input, output, ZodType } from "zod";

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
export type WebDrawers = readonly string[] | Readonly<Record<string, unknown>>;
export type WebSurfacePublication = Readonly<{
  load: () => Promise<unknown>;
  provider?: unknown;
  order?: number;
}>;
export type WebSurfacePublications = Readonly<Record<string, WebSurfacePublication>>;

type WebModuleDeclaration = Readonly<{
  screens: WebScreens;
  drawers: WebDrawers;
  publications: WebSurfacePublications;
  mounts: readonly string[];
  flags: readonly string[];
}>;

type EmptyDeclaration = Readonly<{
  screens: Empty;
  drawers: readonly [];
  publications: Empty;
  mounts: readonly [];
  flags: readonly [];
}>;

export type WebModuleConfig = Readonly<{
  schema: ZodType;
  project: (config: PublicAppConfig) => unknown;
}>;

export type WebModuleInstallation = Readonly<{
  name: string;
  requirements: readonly UiSupplyName[];
  config?: WebModuleConfig;
  screens: WebScreens;
  drawers: WebDrawers;
  publications: WebSurfacePublications;
  mounts: readonly string[];
  flags: readonly string[];
  api?: unknown;
  commands?: unknown;
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
type FlagRequirements<Flags extends readonly string[]> = IfPresent<
  Flags[number],
  RequirementFields<"session">
>;
type CheckedLiteralTuple<Values extends readonly string[]> = number extends Values["length"]
  ? never
  : string extends Values[number]
    ? never
    : unknown;
type CheckedKeyedRecord<Value extends object> = string extends keyof Value ? never : unknown;
type CheckedDrawers<Drawers extends WebDrawers> = Drawers extends readonly string[]
  ? CheckedLiteralTuple<Drawers>
  : CheckedKeyedRecord<Drawers>;

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
      drawers: [],
      publications: {},
      mounts: [],
      flags: [],
      slots: [],
      seatTypeCopy: false,
      failureInterceptors: [],
    });
  }

  get installation(): WebModuleInstallation {
    return this.#installation;
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
    ..._checked: [CheckedDrawers<Drawers>] extends [never] ? [never] : []
  ): WebModule<
    Name,
    Requirements,
    Config,
    Merge<Declaration, { readonly drawers: Drawers }>,
    Precise
  > {
    return this.#next({ ...this.#installation, drawers });
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

  withCommands<Commands>(
    commands: Commands,
  ): WebModule<Name, Requirements, Config, Declaration, Precise> {
    return this.#next({ ...this.#installation, commands });
  }

  withFlags<const Flags extends readonly string[]>(
    flags: Flags,
    ..._checked: [CheckedLiteralTuple<Flags>] extends [never] ? [never] : []
  ): WebModule<
    Name,
    Merge<Requirements, FlagRequirements<Flags>>,
    Config,
    Merge<Declaration, { readonly flags: Flags }>,
    Precise
  > {
    const requirements: readonly UiSupplyName[] =
      flags.length === 0
        ? this.#installation.requirements
        : mergeNames(this.#installation.requirements, ["session"]);
    return this.#next({ ...this.#installation, requirements, flags });
  }

  withConfig<Schema extends ZodType>(
    schema: Schema,
    project: (config: PublicAppConfig) => input<Schema>,
  ): WebModule<
    Name,
    Merge<Requirements, RequirementFields<"injected-config">>,
    Merge<Config, { readonly [Key in Name]: output<Schema> }>,
    Declaration,
    Precise
  > {
    return this.#next({
      ...this.#installation,
      config: { schema, project },
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

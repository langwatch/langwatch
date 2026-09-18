import type { PublicAppConfig } from "@langwatch/config/public-app-config";

import { checkHostMounts } from "./ui-host-mounts.ts";
import { UiFacilitiesSupply, UiShellSupply } from "./ui-supply.options.ts";
import type {
  CheckedUiModules,
  Merge,
  MissingUiSupplyFields,
  RequiredUiConfig,
  UiRequirementValue,
} from "./ui-supply.types.ts";
import type { SupplyModule, UiSupplyName } from "./web-module.ts";

type SupplyRecord = Readonly<Record<string, unknown>>;
type Empty = Record<never, never>;

export type UiDocument = Pick<Document, "getElementById" | "querySelector">;
export type InjectedConfigReader = (document: UiDocument) => PublicAppConfig;

export type CreateUiOptions = Readonly<{
  document: UiDocument;
  mount: string | Element;
}>;

export type UiRenderResult<Config extends object = SupplyRecord> = Readonly<{
  document: UiDocument;
  mount: Element;
  modules: readonly SupplyModule[];
  config: Config;
  supplied: SupplyRecord;
}>;

export class BrowserConfigMissingError extends Error {
  readonly code = "browser_config_missing";

  constructor() {
    super("The browser configuration is missing or could not be read.");
    this.name = "BrowserConfigMissingError";
  }
}

export class BrowserConfigRefusedError extends Error {
  readonly code = "browser_config_refused";

  constructor(readonly module: string) {
    super(`The browser configuration was refused by module ${JSON.stringify(module)}.`);
    this.name = "BrowserConfigRefusedError";
  }
}

export class BrowserMountMissingError extends Error {
  readonly code = "browser_mount_missing";

  constructor(readonly mount: string) {
    super(`The browser mount ${JSON.stringify(mount)} does not exist.`);
    this.name = "BrowserMountMissingError";
  }
}

export class BrowserSupplyMissingError extends Error {
  readonly code = "browser_supply_missing";

  constructor(readonly missing: readonly string[]) {
    super(`The browser is missing supplies: ${missing.join(", ")}.`);
    this.name = "BrowserSupplyMissingError";
  }
}

declare const missingUiSupply: unique symbol;
interface MissingUiSupply<Names extends string> {
  readonly [missingUiSupply]: Names;
}

type Render<Modules extends readonly SupplyModule[], Outstanding extends object> = [
  keyof Outstanding,
] extends [never]
  ? () => Promise<UiRenderResult<RequiredUiConfig<Modules>>>
  : MissingUiSupply<keyof Outstanding & string>;

type UiSupplyState = Readonly<{
  document: UiDocument;
  mount: string | Element;
  modules: readonly SupplyModule[];
  supplied: SupplyRecord;
  mountedByShell: readonly string[];
}>;

/**
 * `UiScopeHost` is mounted by this package's own `createUiFeatureShell`
 * (`ui-feature-shell.tsx`), unconditionally — no module declares it, so no
 * module needs to.
 */
const KERNEL_MOUNTED_HOSTS: readonly string[] = ["UiScopeHost"];

declare const uiSupplyState: unique symbol;

export class UiSupply<
  Modules extends readonly SupplyModule[] = [],
  Supplied extends object = Empty,
  Outstanding extends object = MissingUiSupplyFields<Modules, Supplied>,
> {
  declare readonly [uiSupplyState]: (
    modules: Modules,
    supplied: Supplied,
    outstanding: Outstanding,
  ) => void;
  declare readonly render: Render<Modules, Outstanding>;
  readonly #state: UiSupplyState;

  private constructor(state: UiSupplyState) {
    this.#state = state;
    Object.defineProperty(this, "render", {
      configurable: false,
      enumerable: false,
      value: () => this.#render(),
      writable: false,
    });
  }

  static create(options: CreateUiOptions): UiSupply {
    return new UiSupply({ ...options, modules: [], supplied: {}, mountedByShell: [] });
  }

  withModules<const Next extends readonly SupplyModule[]>(
    modules: Next,
    ..._checked: [CheckedUiModules<Next>] extends [never] ? [never] : []
  ) {
    return new UiSupply<[...Modules, ...Next], Supplied>({
      ...this.#state,
      modules: [...this.#state.modules, ...modules],
    });
  }

  /**
   * `*HostApi` names the composing application mounts itself, outside any
   * module's tree — a mount this package otherwise cannot see.
   */
  withMountedHosts(hosts: readonly string[]): UiSupply<Modules, Supplied, Outstanding> {
    return new UiSupply({
      ...this.#state,
      mountedByShell: [...this.#state.mountedByShell, ...hosts],
    });
  }

  withInjectedConfig<Reader extends InjectedConfigReader>(reader: Reader) {
    return this.#withSupply({ "injected-config": reader });
  }

  withTransport<Value extends UiRequirementValue<Modules, "transport">>(transport: Value) {
    return this.#withSupply({ transport });
  }

  withSession<Value extends UiRequirementValue<Modules, "session">>(session: Value) {
    return this.#withSupply({ session });
  }

  withFacilities<Next extends object>(
    configure: (facilities: UiFacilitiesSupply<Modules>) => UiFacilitiesSupply<Modules, Next>,
  ) {
    const facilities = configure(UiFacilitiesSupply.create<Modules>());
    return this.#withSupply(facilities.supplied as Next);
  }

  withShell<Next extends object>(
    configure: (shell: UiShellSupply<Modules>) => UiShellSupply<Modules, Next>,
  ) {
    const shell = configure(UiShellSupply.create<Modules>());
    return this.#withSupply(shell.supplied as Next);
  }

  #withSupply<Next extends object>(next: Next): UiSupply<Modules, Merge<Supplied, Next>> {
    return new UiSupply<Modules, Merge<Supplied, Next>>({
      ...this.#state,
      supplied: { ...this.#state.supplied, ...next },
    });
  }

  async #render(): Promise<UiRenderResult> {
    const missing = this.#missingSupplies();
    if (missing.length > 0) throw new BrowserSupplyMissingError(missing);
    checkHostMounts({
      modules: this.#state.modules,
      mountedByShell: [...KERNEL_MOUNTED_HOSTS, ...this.#state.mountedByShell],
    });
    const mount = this.#resolveMount();
    const config = this.#readConfig();
    return {
      document: this.#state.document,
      mount,
      modules: this.#state.modules,
      config,
      supplied: this.#state.supplied,
    };
  }

  #missingSupplies(): readonly string[] {
    const required = new Set<UiSupplyName>();
    for (const module of this.#state.modules) {
      for (const name of module.installation.requirements) required.add(name);
    }
    return [...required].filter((name) => !(name in this.#state.supplied));
  }

  #resolveMount(): Element {
    if (typeof this.#state.mount !== "string") return this.#state.mount;
    const mount = this.#state.document.getElementById(this.#state.mount);
    if (!mount) throw new BrowserMountMissingError(this.#state.mount);
    return mount;
  }

  #readConfig(): SupplyRecord {
    const configured = this.#state.modules.filter(
      (module) => module.installation.config !== void 0,
    );
    if (configured.length === 0) return {};

    const reader = this.#state.supplied["injected-config"];
    if (typeof reader !== "function") throw new BrowserConfigMissingError();

    let envelope: PublicAppConfig;
    try {
      envelope = (reader as InjectedConfigReader)(this.#state.document);
    } catch {
      throw new BrowserConfigMissingError();
    }

    const slices: Record<string, unknown> = {};
    for (const module of configured) {
      const declaration = module.installation.config;
      if (!declaration) continue;
      try {
        slices[module.name] = declaration.schema.parse(declaration.project(envelope));
      } catch {
        throw new BrowserConfigRefusedError(module.name);
      }
    }
    return slices;
  }
}

export function createUi(options: CreateUiOptions): UiSupply {
  return UiSupply.create(options);
}

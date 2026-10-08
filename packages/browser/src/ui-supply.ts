import {
  processWebConfigSchema,
  type ProcessWebConfig,
  type PublicAppConfig,
} from "@langwatch/config/public-app-config";

import { checkHostMounts } from "./module/ui-host-mounts.ts";
import { checkHostServices, UI_HOST_SERVICES } from "./module/ui-module-host-services.ts";
import { checkLends } from "./module/ui-module-lends.ts";
import { checkScreenAddresses } from "./page/ui-screen-addresses.ts";
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

/** Names the module that refused its slices, or the owner slice nothing installed admits. */
export class BrowserConfigRefusedError extends Error {
  readonly code = "browser_config_refused";
  readonly module?: string;
  readonly owner?: string;

  constructor(refusal: Readonly<{ module: string }> | Readonly<{ owner: string }>) {
    super(
      "module" in refusal
        ? `The browser configuration was refused by module ${JSON.stringify(refusal.module)}.`
        : `The browser configuration slice ${JSON.stringify(refusal.owner)} was refused.`,
    );
    this.name = "BrowserConfigRefusedError";
    if ("module" in refusal) this.module = refusal.module;
    else this.owner = refusal.owner;
  }
}

/** The owner every composition admits: the process's own slice (rulings R2). */
const PROCESS_OWNER = "process";

/** The process owner's slice, parsed: a composition reads it before render, for its transport. */
export function readUiProcessConfig(envelope: PublicAppConfig): ProcessWebConfig {
  const parsed = processWebConfigSchema.safeParse(envelope[PROCESS_OWNER]);
  if (!parsed.success) throw new BrowserConfigRefusedError({ owner: PROCESS_OWNER });
  return parsed.data;
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
    checkLends({ modules: this.#state.modules });
    checkHostServices({ modules: this.#state.modules, services: UI_HOST_SERVICES });
    checkScreenAddresses({ modules: this.#state.modules });
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

    refuseUnclaimed({ envelope, modules: configured });
    readUiProcessConfig(envelope);

    const installed: Record<string, unknown> = {};
    for (const module of configured) {
      const declaration = module.installation.config;
      if (!declaration) continue;
      try {
        const read: Record<string, unknown> = {};
        for (const [owner, schema] of Object.entries(declaration.slices)) {
          read[owner] = schema.parse(envelope[owner]);
        }
        installed[module.name] = declaration.project(read as never);
      } catch {
        throw new BrowserConfigRefusedError({ module: module.name });
      }
    }
    return installed;
  }
}

/** One image writes and reads the envelope, so an owner no installed module claims is skew. */
function refuseUnclaimed({
  envelope,
  modules,
}: {
  envelope: PublicAppConfig;
  modules: readonly SupplyModule[];
}): void {
  const claimed = new Set([PROCESS_OWNER]);
  for (const module of modules) {
    for (const owner of Object.keys(module.installation.config?.slices ?? {})) claimed.add(owner);
  }
  const unclaimed = Object.keys(envelope).find((owner) => !claimed.has(owner));
  if (unclaimed !== void 0) throw new BrowserConfigRefusedError({ owner: unclaimed });
}

export function createUi(options: CreateUiOptions): UiSupply {
  return UiSupply.create(options);
}

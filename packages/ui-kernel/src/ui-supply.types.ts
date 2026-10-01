import type { SupplyModule } from "./web-module.ts";

export type Simplify<Value> = { [Key in keyof Value]: Value[Key] } & {};
export type Merge<Left, Right> = Simplify<Omit<Left, keyof Right> & Right>;

type Empty = Record<never, never>;
type Intersection<Union> = [Union] extends [never]
  ? Empty
  : (Union extends unknown ? (value: Union) => void : never) extends (value: infer Value) => void
    ? Value
    : never;

type ModuleRequirements<Module> = Module extends {
  readonly types: { readonly requirements: infer Requirements extends object };
}
  ? Requirements
  : Empty;

type ModuleConfig<Module> = Module extends {
  readonly types: { readonly config: infer Config extends object };
}
  ? Config
  : Empty;

export type RequiredUiSupply<Modules extends readonly SupplyModule[]> = Simplify<
  Intersection<
    Modules[number] extends infer Module
      ? Module extends unknown
        ? ModuleRequirements<Module>
        : never
      : never
  >
>;

export type RequiredUiConfig<Modules extends readonly SupplyModule[]> = Simplify<
  Intersection<
    Modules[number] extends infer Module
      ? Module extends unknown
        ? ModuleConfig<Module>
        : never
      : never
  >
>;

type Missing<Required, Supplied> = {
  readonly [
    Key in keyof Required as Supplied extends {
      readonly [SuppliedKey in Key]-?: Required[SuppliedKey];
    }
      ? never
      : Key
  ]: Required[Key];
};

export type MissingUiSupplyFields<Modules extends readonly SupplyModule[], Supplied> = Simplify<
  Missing<RequiredUiSupply<Modules>, Supplied>
>;

export type MissingUiSupplyNames<
  Modules extends readonly SupplyModule[],
  Supplied,
> = keyof MissingUiSupplyFields<Modules, Supplied> & string;

export type UiRequirementValue<
  Modules extends readonly SupplyModule[],
  Name extends string,
> = Name extends keyof RequiredUiSupply<Modules> ? RequiredUiSupply<Modules>[Name] : unknown;

export type CheckedUiModules<Modules extends readonly SupplyModule[]> =
  number extends Modules["length"]
    ? never
    : boolean extends Modules[number]["types"]["precise"]
      ? never
      : string extends Modules[number]["types"]["name"]
        ? never
        : unknown;

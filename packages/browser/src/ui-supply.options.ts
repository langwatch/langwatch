import type { Merge, UiRequirementValue } from "./ui-supply.types.ts";
import type { SupplyModule } from "./web-module.ts";

type SupplyRecord = Readonly<Record<string, unknown>>;
type Empty = Record<never, never>;

declare const facilitiesState: unique symbol;

export class UiFacilitiesSupply<
  Modules extends readonly SupplyModule[],
  Supplied extends object = Empty,
> {
  declare readonly [facilitiesState]: (modules: Modules, supplied: Supplied) => void;
  readonly #values: SupplyRecord;

  private constructor(values: SupplyRecord) {
    this.#values = values;
  }

  static create<Modules extends readonly SupplyModule[]>(): UiFacilitiesSupply<Modules> {
    return new UiFacilitiesSupply({});
  }

  get supplied(): SupplyRecord {
    return this.#values;
  }

  withFeedback<Value extends UiRequirementValue<Modules, "feedback">>(feedback: Value) {
    return this.#with({ feedback });
  }

  withStorage<Value extends UiRequirementValue<Modules, "storage">>(storage: Value) {
    return this.#with({ storage });
  }

  withDocumentTitle<Value extends UiRequirementValue<Modules, "document-title">>(
    documentTitle: Value,
  ) {
    return this.#with({ "document-title": documentTitle });
  }

  withAnalytics<Value extends UiRequirementValue<Modules, "analytics">>(analytics: Value) {
    return this.#with({ analytics });
  }

  #with<Next extends SupplyRecord>(next: Next): UiFacilitiesSupply<Modules, Merge<Supplied, Next>> {
    return new UiFacilitiesSupply({ ...this.#values, ...next });
  }
}

declare const shellState: unique symbol;

export class UiShellSupply<
  Modules extends readonly SupplyModule[],
  Supplied extends object = Empty,
> {
  declare readonly [shellState]: (modules: Modules, supplied: Supplied) => void;
  readonly #values: SupplyRecord;

  private constructor(values: SupplyRecord) {
    this.#values = values;
  }

  static create<Modules extends readonly SupplyModule[]>(): UiShellSupply<Modules> {
    return new UiShellSupply({});
  }

  get supplied(): SupplyRecord {
    return this.#values;
  }

  withToaster<Value extends UiRequirementValue<Modules, "toaster">>(toaster: Value) {
    return this.#with({ toaster });
  }

  withGraphicsQuality<Value extends UiRequirementValue<Modules, "graphics-quality">>(
    graphicsQuality: Value,
  ) {
    return this.#with({ "graphics-quality": graphicsQuality });
  }

  withBootRefusal<Value extends UiRequirementValue<Modules, "boot-refusal">>(bootRefusal: Value) {
    return this.#with({ "boot-refusal": bootRefusal });
  }

  #with<Next extends SupplyRecord>(next: Next): UiShellSupply<Modules, Merge<Supplied, Next>> {
    return new UiShellSupply({ ...this.#values, ...next });
  }
}

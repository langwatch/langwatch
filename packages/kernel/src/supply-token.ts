import type { OperationsOnly } from "./module-api-token.ts";

export abstract class SupplyTokenIdentity {
  declare private readonly supplyTokenIdentity: void;

  protected constructor(readonly name: string) {}
}

/** Runtime identity for a process-provided dependency outside the module namespace. */
export class SupplyToken<Api, Name extends string = string> extends SupplyTokenIdentity {
  declare readonly name: Name;
  declare private readonly api: (value: Api) => Api;

  private constructor(name: Name) {
    super(name);
  }

  static create<Api, const Name extends string>(name: Name): SupplyToken<Api, Name> {
    if (name.length === 0) throw new TypeError("A supply token name cannot be empty.");
    const token = new SupplyToken<Api, Name>(name);
    Object.freeze(token);
    return token;
  }
}

export function supplyToken<Api extends OperationsOnly<Api>>(name: string): SupplyToken<Api>;
export function supplyToken<Api extends OperationsOnly<Api>>(): <const Name extends string>(
  name: Name,
) => SupplyToken<Api, Name>;
export function supplyToken<Api extends OperationsOnly<Api>>(name?: string) {
  if (name === void 0) {
    return <const Name extends string>(id: Name) => SupplyToken.create<Api, Name>(id);
  }
  return SupplyToken.create<Api, string>(name);
}

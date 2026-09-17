import { FeatureApiUnavailableError } from "./boot-errors.ts";
import type { FeatureApiIdentity, ModuleApiToken } from "./module-api-token.ts";

/** References are wired at boot, never constructed on a request's first call. */
export class LocalFeatureApis {
  private phase: "constructing" | "ready" | "closed" = "constructing";
  private readonly bindings = new Map<FeatureApiIdentity, LocalFeatureApi>();

  declare(token: FeatureApiIdentity): void {
    this.assertConstructing();
    if (this.bindings.has(token)) {
      throw new Error(`Feature API "${token.name}" was declared twice.`);
    }
    this.bindings.set(token, new LocalFeatureApi(token.name, () => this.assertReady(token)));
  }

  reference<Api>(token: ModuleApiToken<Api>): Api;
  reference(token: FeatureApiIdentity): object;
  reference(token: FeatureApiIdentity): object {
    return this.binding(token).reference;
  }

  bind<Token extends FeatureApiIdentity>(
    token: Token,
    implementation: Token extends ModuleApiToken<infer Api> ? NoInfer<Api> : unknown,
  ): void {
    this.assertConstructing();
    this.binding(token).bind(implementation);
  }

  ready(): void {
    this.assertConstructing();
    for (const binding of this.bindings.values()) binding.assertBound();
    this.phase = "ready";
  }

  close(): void {
    this.phase = "closed";
  }

  private assertConstructing(): void {
    if (this.phase !== "constructing") {
      throw new Error(`Feature API bindings are ${this.phase}.`);
    }
  }

  private binding(token: FeatureApiIdentity): LocalFeatureApi {
    const binding = this.bindings.get(token);
    if (!binding) throw new Error(`Feature API "${token.name}" was not declared.`);
    return binding;
  }

  private assertReady(token: FeatureApiIdentity): void {
    if (this.phase !== "ready") throw new FeatureApiUnavailableError(token.name, this.phase);
  }
}

class LocalFeatureApi {
  static readonly #clients = new WeakMap<object, LocalFeatureApi>();
  readonly reference: object;
  private implementation: object | undefined;
  private readonly operations = new Map<PropertyKey, (...args: unknown[]) => unknown>();

  constructor(
    private readonly name: string,
    private readonly assertReady: () => void,
  ) {
    this.reference = new Proxy(
      {},
      {
        get: (_target, property) => this.operation(property),
        set: () => {
          throw new TypeError(`Feature API "${this.name}" is read-only.`);
        },
        defineProperty: () => false,
        deleteProperty: () => false,
        setPrototypeOf: () => false,
      },
    );
    LocalFeatureApi.#clients.set(this.reference, this);
  }

  bind(implementation: unknown): void {
    if (this.implementation) throw new Error(`Feature API "${this.name}" was bound twice.`);
    if (typeof implementation !== "object" || implementation === null) {
      throw new TypeError(`Feature API "${this.name}" must be implemented by an object.`);
    }
    this.assertAcyclic(implementation);
    this.implementation = implementation;
  }

  private assertAcyclic(implementation: object): void {
    const visited = new Set<LocalFeatureApi>([this]);
    let client = LocalFeatureApi.#clients.get(implementation);
    while (client) {
      if (visited.has(client)) {
        throw new TypeError(`Feature API "${this.name}" has a cyclic client binding.`);
      }
      visited.add(client);
      client = client.implementation ? LocalFeatureApi.#clients.get(client.implementation) : void 0;
    }
  }

  assertBound(): object {
    if (!this.implementation) throw new Error(`Feature API "${this.name}" has no implementation.`);
    return this.implementation;
  }

  private operation(property: PropertyKey): unknown {
    this.assertReady();
    const implementation = this.assertBound();
    if (property === "then") return void 0;
    if (property === "constructor" || property === "__proto__" || property === "prototype") {
      return void 0;
    }
    const existing = this.operations.get(property);
    if (existing) return existing;
    const client = LocalFeatureApi.#clients.get(implementation);
    const value: unknown = client
      ? client.operation(property)
      : operationDescriptor(implementation, property)?.value;
    if (typeof value !== "function") {
      throw new TypeError(
        `Feature API "${this.name}" exposes operations only: ${String(property)} is not callable.`,
      );
    }
    const operation = (...args: unknown[]): unknown => {
      this.assertReady();
      return Reflect.apply(value, implementation, args);
    };
    this.operations.set(property, operation);
    return operation;
  }
}

function operationDescriptor(
  implementation: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  let target: object | null = implementation;
  while (target !== null && target !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (descriptor) return descriptor;
    target = Object.getPrototypeOf(target);
  }
  return void 0;
}

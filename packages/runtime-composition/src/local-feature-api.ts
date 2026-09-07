import { FeatureApiUnavailableError } from "./boot-errors.ts";
import type { FeatureApiIdentity } from "./feature-api-token.ts";

/** References are wired at boot, never constructed on a request's first call. */
export class LocalFeatureApis {
  private phase: "constructing" | "ready" | "closed" = "constructing";
  private readonly bindings = new Map<FeatureApiIdentity, LocalFeatureApi>();

  declare(token: FeatureApiIdentity): void {
    this.bindings.set(token, new LocalFeatureApi(token.name, () => this.assertReady(token)));
  }

  reference(token: FeatureApiIdentity): object {
    return this.binding(token).reference;
  }

  bind(token: FeatureApiIdentity, implementation: unknown): void {
    this.binding(token).bind(implementation);
  }

  ready(): void {
    for (const binding of this.bindings.values()) binding.assertBound();
    this.phase = "ready";
  }

  close(): void {
    this.phase = "closed";
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
  }

  bind(implementation: unknown): void {
    if (this.implementation) throw new Error(`Feature API "${this.name}" was bound twice.`);
    if (typeof implementation !== "object" || implementation === null) {
      throw new TypeError(`Feature API "${this.name}" must be implemented by an object.`);
    }
    this.implementation = implementation;
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
    const descriptor = operationDescriptor(implementation, property);
    const value: unknown = descriptor?.value;
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

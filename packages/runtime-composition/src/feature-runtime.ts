import { type Capability, CapabilityRegistry } from "./capability";
import { ResourceScope } from "./resource-scope";

export type RuntimeTarget = "app" | "worker";

export type FeatureInstallContext<Infrastructure> = {
  infrastructure: Infrastructure;
  require<Value>(token: Capability<Value>): Value;
  provide<Value>(token: Capability<Value>, value: Value): void;
  resources: ResourceScope;
};

export type FeatureRuntimeContext = {
  require<Value>(token: Capability<Value>): Value;
  resources: ResourceScope;
};

export type FeatureDefinitionOptions<Infrastructure> = {
  name: string;
  requires?: readonly Capability<unknown>[];
  provides?: readonly Capability<unknown>[];
  services?(context: FeatureInstallContext<Infrastructure>): void | Promise<void>;
  app?(context: FeatureRuntimeContext): void | Promise<void>;
  worker?(context: FeatureRuntimeContext): void | Promise<void>;
};

/** An immutable, side-effect-free feature contribution declaration. */
export class FeatureDefinition<Infrastructure = unknown> {
  declare private readonly infrastructureType: Infrastructure;

  static create<Infrastructure = unknown>(
    options: FeatureDefinitionOptions<Infrastructure>,
  ): FeatureDefinition<Infrastructure> {
    return new FeatureDefinition(options);
  }

  readonly name: string;
  readonly requires: readonly Capability<unknown>[];
  readonly provides: readonly Capability<unknown>[];
  readonly services:
    | ((context: FeatureInstallContext<Infrastructure>) => void | Promise<void>)
    | undefined;
  readonly app: ((context: FeatureRuntimeContext) => void | Promise<void>) | undefined;
  readonly worker: ((context: FeatureRuntimeContext) => void | Promise<void>) | undefined;

  private constructor(options: FeatureDefinitionOptions<Infrastructure>) {
    this.name = options.name.trim();
    if (!this.name) {
      throw new Error("Feature names cannot be empty.");
    }
    this.requires = Object.freeze([...(options.requires ?? [])]);
    this.provides = Object.freeze([...(options.provides ?? [])]);
    this.services = options.services;
    this.app = options.app;
    this.worker = options.worker;
    Object.freeze(this);
  }
}

export type FeatureRuntime = Readonly<{
  registry: CapabilityRegistry;
  resources: ResourceScope;
}>;

export type FeatureRuntimeBuilderOptions<Infrastructure> = {
  infrastructure: Infrastructure;
  resources?: ResourceScope;
};

export type FeatureRuntimeBuildOptions<Infrastructure> = {
  features: readonly FeatureDefinition<Infrastructure>[];
  target: RuntimeTarget;
};

/**
 * Installs one explicit feature catalogue and seals its service graph before
 * any target-specific adapter hook is allowed to run.
 */
export class FeatureRuntimeBuilder<Infrastructure> {
  static create<Infrastructure>(
    options: FeatureRuntimeBuilderOptions<Infrastructure>,
  ): FeatureRuntimeBuilder<Infrastructure> {
    return new FeatureRuntimeBuilder(
      options.infrastructure,
      options.resources ?? new ResourceScope(),
    );
  }

  private constructor(
    private readonly infrastructure: Infrastructure,
    private readonly resources: ResourceScope,
  ) {}

  async build({
    features,
    target,
  }: FeatureRuntimeBuildOptions<Infrastructure>): Promise<FeatureRuntime> {
    FeatureRuntimeBuilder.validateGraph(features);
    const registry = CapabilityRegistry.create();
    const remaining = [...features];

    while (remaining.length > 0) {
      const index = remaining.findIndex((feature) =>
        feature.requires.every((token) => registry.has(token)),
      );
      if (index < 0) {
        throw new Error(
          `Feature capability graph cannot be ordered: ${remaining.map(({ name }) => name).join(", ")}.`,
        );
      }
      const [feature] = remaining.splice(index, 1);
      if (!feature) continue;
      const required = new Set(feature.requires.map(({ key }) => key));
      const declared = new Set(feature.provides.map(({ key }) => key));
      await feature.services?.({
        infrastructure: this.infrastructure,
        resources: this.resources,
        require: (token) => {
          FeatureRuntimeBuilder.assertDeclaredRequirement(feature, token, required);
          return registry.require(token, feature.name);
        },
        provide: (token, value) => {
          if (!declared.has(token.key)) {
            throw new Error(
              `Feature "${feature.name}" provided undeclared capability "${token.key}".`,
            );
          }
          registry.provide(token, value, feature.name);
        },
      });
      for (const token of feature.provides) {
        if (!registry.has(token)) {
          throw new Error(
            `Feature "${feature.name}" did not install declared capability "${token.key}".`,
          );
        }
      }
    }

    registry.seal();
    for (const feature of features) {
      const visible = new Set(
        [...feature.requires, ...feature.provides].map(({ key }) => key),
      );
      await feature[target]?.({
        resources: this.resources,
        require: (token) => {
          FeatureRuntimeBuilder.assertDeclaredRequirement(feature, token, visible);
          return registry.require(token, feature.name);
        },
      });
    }
    return Object.freeze({ registry, resources: this.resources });
  }

  private static validateGraph<Infrastructure>(
    features: readonly FeatureDefinition<Infrastructure>[],
  ): void {
    const providers = new Map<string, string>();
    for (const feature of features) {
      for (const token of feature.provides) {
        const existing = providers.get(token.key);
        if (existing) {
          throw new Error(
            `Capability "${token.key}" is declared by both "${existing}" and "${feature.name}".`,
          );
        }
        providers.set(token.key, feature.name);
      }
    }
    for (const feature of features) {
      for (const token of feature.requires) {
        if (!providers.has(token.key)) {
          throw new Error(
            `Feature "${feature.name}" requires missing capability "${token.key}".`,
          );
        }
      }
    }
  }

  private static assertDeclaredRequirement<Infrastructure>(
    feature: FeatureDefinition<Infrastructure>,
    token: Capability<unknown>,
    declared: ReadonlySet<string>,
  ): void {
    if (!declared.has(token.key)) {
      throw new Error(
        `Feature "${feature.name}" required undeclared capability "${token.key}".`,
      );
    }
  }
}

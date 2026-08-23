import { type Capability, CapabilityRegistry } from "./capabilities";
import { ResourceScope } from "./resource-scope";

export type RuntimeTarget = "app" | "worker";

export type FeatureInstallContext<Infrastructure> = {
  infrastructure: Infrastructure;
  require<T>(token: Capability<T>): T;
  provide<T>(token: Capability<T>, value: T): void;
  resources: ResourceScope;
};

export type FeatureRuntimeContext = {
  require<T>(token: Capability<T>): T;
  resources: ResourceScope;
};

export type FeatureDefinition<Infrastructure = unknown> = {
  name: string;
  requires?: readonly Capability<unknown>[];
  provides?: readonly Capability<unknown>[];
  services?(
    context: FeatureInstallContext<Infrastructure>,
  ): void | Promise<void>;
  app?(context: FeatureRuntimeContext): void | Promise<void>;
  worker?(context: FeatureRuntimeContext): void | Promise<void>;
};

export function defineFeature<Infrastructure>(
  definition: FeatureDefinition<Infrastructure>,
): FeatureDefinition<Infrastructure> {
  return Object.freeze(definition);
}

function validateGraph<Infrastructure>(
  features: readonly FeatureDefinition<Infrastructure>[],
): Map<string, string> {
  const providers = new Map<string, string>();
  for (const feature of features) {
    for (const token of feature.provides ?? []) {
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
    for (const token of feature.requires ?? []) {
      if (!providers.has(token.key)) {
        throw new Error(
          `Feature "${feature.name}" requires missing capability "${token.key}".`,
        );
      }
    }
  }
  return providers;
}

export async function buildFeatureRuntime<Infrastructure>({
  features,
  infrastructure,
  target,
  resources = new ResourceScope(),
}: {
  features: readonly FeatureDefinition<Infrastructure>[];
  infrastructure: Infrastructure;
  target: RuntimeTarget;
  resources?: ResourceScope;
}): Promise<{ registry: CapabilityRegistry; resources: ResourceScope }> {
  validateGraph(features);
  const registry = new CapabilityRegistry();
  const remaining = [...features];

  while (remaining.length > 0) {
    const index = remaining.findIndex((feature) =>
      (feature.requires ?? []).every((token) => registry.has(token)),
    );
    if (index < 0) {
      throw new Error(
        `Feature capability graph cannot be ordered: ${remaining.map(({ name }) => name).join(", ")}.`,
      );
    }
    const [feature] = remaining.splice(index, 1);
    if (!feature) continue;
    const declared = new Set((feature.provides ?? []).map(({ key }) => key));
    await feature.services?.({
      infrastructure,
      resources,
      require: (token) => registry.require(token, feature.name),
      provide: (token, value) => {
        if (!declared.has(token.key)) {
          throw new Error(
            `Feature "${feature.name}" provided undeclared capability "${token.key}".`,
          );
        }
        registry.provide(token, value, feature.name);
      },
    });
    for (const token of feature.provides ?? []) {
      if (!registry.has(token)) {
        throw new Error(
          `Feature "${feature.name}" did not install declared capability "${token.key}".`,
        );
      }
    }
  }

  const runtimeContext: FeatureRuntimeContext = {
    resources,
    require: (token) => registry.require(token),
  };
  for (const feature of features) {
    await feature[target]?.(runtimeContext);
  }
  registry.seal();
  return { registry, resources };
}

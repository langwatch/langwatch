// Document input: every REST family from module declarations, inert read.
import type { RestTransportDeclaration } from "@langwatch/api/rest";

/** One installed family's declaration, with the module that declared it. */
export type DeclaredRestFamily = Readonly<{
  /** The module the declaration was installed by, for a diagnostic. */
  module: string;
  declaration: RestTransportDeclaration<unknown>;
}>;

/** A module as this reader needs to see it: its name and what it declared. */
export type InstalledModule = Readonly<{
  name?: unknown;
  transports?: readonly {
    readonly protocol?: unknown;
    /** The tRPC namespace, where a descriptor carries one. Unread here. */
    readonly namespace?: unknown;
    readonly router?: unknown;
  }[];
}>;

// REST declarations from all installed modules; unreadable declarations fail.
export function declaredRestFamilies(
  modules: readonly InstalledModule[],
): readonly DeclaredRestFamily[] {
  const families: DeclaredRestFamily[] = [];

  for (const module of modules) {
    const name = typeof module.name === "string" ? module.name : "(unnamed module)";

    for (const descriptor of module.transports ?? []) {
      if (descriptor.protocol !== "rest") continue;

      if (typeof descriptor.router !== "function") {
        throw new Error(
          `Module "${name}" declares a REST transport whose router is not callable, so the ` +
            "OpenAPI document cannot read the family it publishes.",
        );
      }

      families.push({ module: name, declaration: readDeclaration({ name, descriptor }) });
    }
  }

  return families;
}

/** One declaration, or the failure that says whose it was. */
function readDeclaration({
  name,
  descriptor,
}: {
  name: string;
  descriptor: { readonly router?: unknown };
}): RestTransportDeclaration<unknown> {
  try {
    const declaration = (descriptor.router as () => unknown)();

    if (!isRestDeclaration(declaration)) {
      throw new Error("its router returned something that is not a REST declaration");
    }

    return declaration;
  } catch (error) {
    throw new Error(
      `Module "${name}" declares a REST transport the OpenAPI document could not read: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** Whether a value carries the members every declared family publishes. */
function isRestDeclaration(value: unknown): value is RestTransportDeclaration<unknown> {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<RestTransportDeclaration<unknown>>;

  return (
    candidate.protocol === "rest" &&
    typeof candidate.namespace === "string" &&
    Array.isArray(candidate.routes)
  );
}

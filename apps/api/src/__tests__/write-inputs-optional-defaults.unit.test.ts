/**
 * Zod 4 applies a default under `.optional()` and `.partial()`, so such a field is never absent:
 * an update that leaves it out writes the default over the stored value. Walks every installed
 * write input. @vitest-environment node
 * @see specs/api-reference/write-inputs-keep-omitted-fields.feature
 */
import type { TrpcRouterDeclaration } from "@langwatch/api/trpc";
import type { TrpcContract } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

type ZodDef = Record<string, unknown> & { type?: string };

function defOf(schema: unknown): ZodDef | undefined {
  if (typeof schema !== "object" || schema === null || !("_zod" in schema)) return undefined;
  const zod = schema._zod;
  if (typeof zod !== "object" || zod === null || !("def" in zod)) return undefined;
  const def = zod.def;
  return typeof def === "object" && def !== null ? (def as ZodDef) : undefined;
}

const PASS_THROUGH = new Set(["nullable", "readonly", "catch", "nonoptional"]);

type Visited = Map<unknown, Set<boolean>>;

/** Every path in a parser where a default sits under an optional, so omission is impossible. */
function optionalDefaults(schema: unknown, path: string, seen: Visited, under = false): string[] {
  const def = defOf(schema);
  const marks = seen.get(schema) ?? new Set<boolean>();
  if (!def || marks.has(under)) return [];
  seen.set(schema, marks.add(under));
  const walk = (child: unknown, at: string, optional = false) =>
    optionalDefaults(child, at, seen, optional);
  if (def.type === "default" || def.type === "prefault") {
    return [...(under ? [path] : []), ...walk(def.innerType, path)];
  }
  if (def.type === "optional") return walk(def.innerType, path, true);
  if (PASS_THROUGH.has(def.type ?? "")) return walk(def.innerType, path, under);
  if (def.type === "pipe") return [...walk(def.in, path, under), ...walk(def.out, path, under)];
  if (def.type === "array") return walk(def.element, `${path}[]`);
  if (def.type === "record") return walk(def.valueType, `${path}{}`);
  if (def.type === "intersection") return [...walk(def.left, path), ...walk(def.right, path)];
  if (Array.isArray(def.options)) {
    return def.options.flatMap((option: unknown) => walk(option, path, under));
  }
  const shape = (def.shape ?? {}) as Record<string, unknown>;
  return Object.entries(shape).flatMap(([key, field]) => walk(field, `${path}.${key}`));
}

const declaresTrpcRouter = (transport: {
  readonly protocol: string;
}): transport is TrpcRouterDeclaration<unknown, TrpcContract> =>
  transport.protocol === "trpc" && "contract" in transport;

type RestRoutes = { routes: readonly { method: string; path: string; input?: unknown }[] };

/** Every installed tRPC mutation input and REST write body, by where a caller reaches it. */
function writeInputs(): { at: string; schema: unknown }[] {
  const inputs: { at: string; schema: unknown }[] = [];
  for (const module of processModules) {
    for (const transport of module.transports ?? []) {
      if (declaresTrpcRouter(transport)) {
        const { namespace, members } = transport.contract;
        for (const [name, member] of Object.entries(members)) {
          if (member.kind !== "mutation") continue;
          inputs.push({ at: `trpc ${namespace}.${name}`, schema: member.input });
        }
      } else if (transport.protocol === "rest" && "router" in transport) {
        const declaration = (transport.router as () => RestRoutes)();
        for (const route of declaration.routes) {
          if (route.method === "GET" || route.input === undefined) continue;
          inputs.push({ at: `rest ${route.method} ${route.path}`, schema: route.input });
        }
      }
    }
  }
  return inputs;
}

describe("the installed write inputs", () => {
  describe("when a field is optional", () => {
    /** @scenario An optional write field carries no default */
    it("carries no default that would fill it in when a caller leaves it out", () => {
      const inputs = writeInputs();
      const found = inputs.flatMap(({ at, schema }) =>
        optionalDefaults(schema, "", new Map()).map((path) => `${at} ${path}`),
      );

      expect(inputs.length).toBeGreaterThan(100);
      expect(found).toEqual([]);
    });
  });
});

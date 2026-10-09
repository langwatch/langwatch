// Request and response JSON Schemas for the readmegen extractor, converted the
// way tools/apidiff/inventory/branch-trpc.mjs converts them: REST from the
// installed declarations, tRPC from every contract that calls defineTrpcContract.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

type Json = unknown;
export type RestSchemas = { namespace: string; operation: string; schemas: Record<string, Json> };
export type TrpcSchemas = { path: string; input: Json; output: Json };
export type Schemas = { rest: RestSchemas[]; trpc: TrpcSchemas[]; errors: string[] };

function toJsonSchema(schema: unknown, io: "input" | "output"): Json {
  if (!schema || typeof schema !== "object") return null;
  try {
    return z.toJSONSchema(schema as z.ZodType, {
      io,
      unrepresentable: "any",
      cycles: "ref",
      reused: "inline",
    });
  } catch (error) {
    return { unconverted: String(error instanceof Error ? error.message : error) };
  }
}

function listDir(dir: string, recursive: boolean): string[] {
  try {
    return readdirSync(dir, { recursive }).map(String);
  } catch {
    return [];
  }
}

function contractFiles(root: string): string[] {
  const files: string[] = [];
  for (const half of ["contract/src", "process/src/transport"])
    for (const parent of ["modules", "enterprise/modules"])
      for (const module of listDir(join(root, parent), false)) {
        const dir = join(root, parent, module, half);
        files.push(
          ...listDir(dir, true)
            .map((entry) => join(dir, entry))
            .filter((file) => file.endsWith(".ts") && !file.includes("__tests__"))
            .filter((file) => readFileSync(file, "utf8").includes("defineTrpcContract(")),
        );
      }

  return files.toSorted((left, right) => left.localeCompare(right));
}

type Contract = {
  namespace: string;
  members: Record<string, { input?: unknown; output?: unknown }>;
};

function isContract(value: unknown): value is Contract {
  const candidate = value as Contract | null;

  return Boolean(
    candidate &&
    typeof candidate.namespace === "string" &&
    candidate.members &&
    typeof candidate.members === "object",
  );
}

async function trpcSchemas(root: string, errors: string[]): Promise<TrpcSchemas[]> {
  const found = new Map<string, TrpcSchemas>();
  for (const file of contractFiles(root)) {
    let exported: Record<string, unknown>;
    try {
      exported = await import(pathToFileURL(file).href);
    } catch (error) {
      errors.push(
        `${relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    for (const value of Object.values(exported).filter(isContract))
      for (const [name, member] of Object.entries(value.members)) {
        const path = `${value.namespace}.${name}`;
        if (!found.has(path))
          found.set(path, {
            path,
            input: toJsonSchema(member.input, "input"),
            output: toJsonSchema(member.output, "output"),
          });
      }
  }

  return [...found.values()].toSorted((left, right) => left.path.localeCompare(right.path));
}

type Route = { operation: string } & Record<string, unknown>;
type Installed = { transports?: { protocol: string; router: () => unknown }[] };

/** The REST roles a route declares, under the names the syntactic read uses. */
const REST_ROLES: [string, string, "input" | "output"][] = [
  ["params", "params", "input"],
  ["query", "query", "input"],
  ["input", "body", "input"],
  ["output", "response", "output"],
];

async function restSchemas(root: string, errors: string[]): Promise<RestSchemas[]> {
  let modules: Installed[];
  try {
    const list = await import(
      pathToFileURL(join(root, "apps/api/src/process-modules.generated.ts")).href
    );
    modules = list.processModules as Installed[];
  } catch (error) {
    errors.push(
      `apps/api/src/process-modules.generated.ts: ${error instanceof Error ? error.message : String(error)}`,
    );

    return [];
  }
  const found: RestSchemas[] = [];
  for (const module of modules)
    for (const transport of (module.transports ?? []).filter((item) => item.protocol === "rest")) {
      const declaration = transport.router() as { namespace: string; routes: Route[] };
      for (const route of declaration.routes) {
        const schemas: Record<string, Json> = {};
        for (const [field, role, io] of REST_ROLES)
          if (route[field]) schemas[role] = toJsonSchema(route[field], io);
        found.push({ namespace: declaration.namespace, operation: route.operation, schemas });
      }
    }

  return found;
}

/** Every schema the installed declarations and the tRPC contracts carry. */
export async function readSchemas({ root }: { root: string }): Promise<Schemas> {
  const errors: string[] = [];
  const rest = await restSchemas(root, errors);
  const trpc = await trpcSchemas(root, errors);

  return { rest, trpc, errors };
}

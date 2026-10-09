// The readmegen extractor (tools/readmegen): reads every catalogued module's
// facts syntactically, booting nothing, and writes one JSON manifest the Go
// renderer decodes. Usage: node --experimental-transform-types main.mts <out> <root> [part]
// where part is "facts" (the modules' facts) or "routes" (the mounted api and the zod
// schemas), else both; Go runs the two parts at once and merges their manifests.
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

import {
  clickhouseTables,
  collectAccess,
  createWorkspaceModuleResolver,
  discoverClassifiedPackages,
  featureClaims,
  type ClassifiedPackage,
  type FeatureCatalogueEntry,
} from "@langwatch/architecture-enforcer";

import { type BrowserFacts, readBrowser, readUiRoutes } from "./browser-facts.mts";
import { type At, type Reading } from "./fold.mts";
import {
  type ApiInterface,
  type Delegate,
  type Leaf,
  type Peer,
  readApiInterface,
  readConfig,
  readPeers,
  readPrismaDelegates,
  readSecrets,
  readStores,
  readTokens,
  sourceFiles,
  type Stores,
  type Token,
} from "./module-facts.mts";
import { type ProcessFacts, readProcess } from "./process-facts.mts";
import { readSchemas } from "./schemas.mts";

type ModuleFacts = {
  id: string;
  tokens: Token[];
  api: ApiInterface | null;
  peers: Peer[];
  secrets: Leaf[];
  config: Leaf[];
  stores: Stores[];
  prismaClaims: { model: string; at: At }[];
  prismaDelegates: Delegate[];
  clickhouseWrites: { table: string; at: At }[];
  process: ProcessFacts;
  browser: BrowserFacts | null;
};

/** A worker's share of the modules: those whose catalogue index is `slice` modulo `of`. */
type Slice = { root: string; slice: number; of: number };

const job = isMainThread ? undefined : (workerData as Slice);
const [outFile = "", rootArgument = "", part = "all"] = job ? [] : process.argv.slice(2);
const root = job?.root ?? rootArgument;
if (!job && (!outFile || !root)) throw new Error("usage: main.mts <out-file> <workspace-root> [part]");

const reading: Reading = { root, resolver: createWorkspaceModuleResolver({ root }) };
const { packages, catalogue } = discoverClassifiedPackages(root);

function halfFiles({ entry, kind }: { entry: FeatureCatalogueEntry; kind: string }): string[] {
  const half = packages.find((pkg) => pkg.feature === entry.id && pkg.kind === kind);

  return half ? sourceFiles({ directory: join(half.root, "src") }) : [];
}

function packageModule({ specifier }: { specifier: string }): string | undefined {
  const scoped = specifier.startsWith("@");
  const name = specifier
    .split("/")
    .slice(0, scoped ? 2 : 1)
    .join("/");

  return packages.find((pkg: ClassifiedPackage) => pkg.name === name)?.feature;
}

function moduleOfFile(file: string): string {
  const owner = packages.find((pkg) => file.startsWith(pkg.root + sep));

  return owner?.feature ?? "";
}

const WORKERS = Math.max(1, Math.min(6, availableParallelism() - 2));

/** Every module's facts, read in slices on worker threads running this file. */
async function readModules(): Promise<ModuleFacts[]> {
  const slices = Array.from({ length: WORKERS }, (_, slice) => {
    const data: Slice = { root, slice, of: WORKERS };

    return new Promise<ModuleFacts[]>((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: data });
      worker.once("message", resolve);
      worker.once("error", reject);
    });
  });
  const byId = new Map((await Promise.all(slices)).flat().map((facts) => [facts.id, facts]));

  return catalogue.flatMap((entry) => byId.get(entry.id) ?? []);
}

/** One worker's modules; table access is read per module root, so a slice keeps its rows whole. */
function readSlice({ slice, of }: Slice): ModuleFacts[] {
  const tokensByModule = new Map(
    catalogue.map((entry) => [
      entry.id,
      readTokens({ files: sourceFiles({ directory: join(root, entry.root) }), reading }),
    ]),
  );
  const moduleOfToken = new Map(
    [...tokensByModule.values()].flat().map((token) => [token.name, token.module]),
  );
  const mine = catalogue.filter((_, index) => index % of === slice);
  const access = collectAccess(root, mine, clickhouseTables(root));

  return mine.map((entry) => factsOf({ entry, tokensByModule, moduleOfToken, access }));
}

function factsOf({
  entry,
  tokensByModule,
  moduleOfToken,
  access,
}: {
  entry: FeatureCatalogueEntry;
  tokensByModule: Map<string, Token[]>;
  moduleOfToken: Map<string, string>;
  access: ReturnType<typeof collectAccess>;
}): ModuleFacts {
  const processFiles = halfFiles({ entry, kind: "process" });
  const tokens = tokensByModule.get(entry.id) ?? [];
  const own = tokens.find((token) => token.module === entry.id);
  const writes = new Map<string, { table: string; at: At }>();

  for (const item of access.filter((row) => row.module === entry.id && row.write)) {
    const where = { file: relative(root, item.file), line: item.line };
    if (!writes.has(item.table)) writes.set(item.table, { table: item.table, at: where });
  }

  return {
    id: entry.id,
    tokens,
    api: own ? (readApiInterface({ token: own, reading }) ?? null) : null,
    peers: readPeers({
      id: entry.id,
      files: processFiles,
      moduleOfToken,
      moduleOfPackage: (specifier) => packageModule({ specifier }),
      reading,
    }),
    secrets: readSecrets({ files: processFiles, reading }),
    config: readConfig({ files: processFiles, reading }),
    stores: readStores({ files: processFiles, reading }),
    prismaClaims: featureClaims(root, entry, []).map((claim) => ({
      model: claim.model,
      at: { file: relative(root, claim.file), line: claim.line },
    })),
    prismaDelegates: readPrismaDelegates({ files: processFiles, reading }),
    clickhouseWrites: [...writes.values()],
    process: readProcess({ files: processFiles, reading, moduleOfFile }),
    browser: readBrowser({ files: halfFiles({ entry, kind: "browser" }), reading }),
  };
}

type MountedRoute = { method: string; path: string; family: string; canonicalPath: string };

/** The api's REST app mounted from the declarations alone, as openapi-document.ts mounts it. */
async function mountedRoutes(): Promise<{ routes: MountedRoute[]; error: string }> {
  try {
    const described = await import(
      pathToFileURL(join(root, "apps/api/src/openapi-document.ts")).href
    );
    described.describedRestApplication();
    const registry = await import(
      pathToFileURL(join(root, "packages/api/src/route-registry.ts")).href
    );
    const routes = (
      registry.allRegisteredRoutes() as (MountedRoute & { isNamespaceGuard?: boolean })[]
    )
      .filter((route) => !route.isNamespaceGuard)
      .map((route) => ({
        method: route.method,
        path: route.path,
        family: route.family,
        canonicalPath: route.canonicalPath ?? "",
      }));

    return { routes, error: "" };
  } catch (error) {
    return { routes: [], error: error instanceof Error ? error.message : String(error) };
  }
}

const facts = async () => ({
  modules: await readModules(),
  uiRoutes: readUiRoutes({ file: join(root, "apps/ui/src/shell/ui-route-table.ts"), reading }),
  packages: packages.map((pkg) => ({
    name: pkg.name,
    root: relative(root, pkg.root),
    kind: pkg.kind,
    feature: pkg.feature ?? "",
  })),
});
const routes = async () => ({ mounted: await mountedRoutes(), schemas: await readSchemas({ root }) });

if (job) {
  parentPort?.postMessage(readSlice(job));
} else {
  const manifest = {
    ...(part === "routes" ? {} : await facts()),
    ...(part === "facts" ? {} : await routes()),
  };

  writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
  // The mounted api graph holds timers and handles open; the manifest is written.
  process.exit(0);
}

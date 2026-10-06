// The readmegen extractor (tools/readmegen): reads every catalogued module's
// facts syntactically, booting nothing, and writes one JSON manifest the Go
// renderer decodes. Usage: node --experimental-transform-types main.mts <out> <root>
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  clickhouseTables,
  collectAccess,
  createWorkspaceModuleResolver,
  discoverClassifiedPackages,
  featureClaims,
  type ClassifiedPackage,
  type FeatureCatalogueEntry,
} from "@langwatch/architecture-enforcer";

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
};

const [outFile, rootArgument] = process.argv.slice(2);
if (!outFile || !rootArgument) throw new Error("usage: main.mts <out-file> <workspace-root>");

const root = rootArgument;
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

const tokensByModule = new Map(
  catalogue.map((entry) => [
    entry.id,
    readTokens({ files: sourceFiles({ directory: join(root, entry.root) }), reading }),
  ]),
);
const moduleOfToken = new Map(
  [...tokensByModule.values()].flat().map((token) => [token.name, token.module]),
);
const access = collectAccess(root, catalogue, clickhouseTables(root));

function factsOf(entry: FeatureCatalogueEntry): ModuleFacts {
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
  };
}

const manifest = {
  modules: catalogue.map(factsOf),
  packages: packages.map((pkg) => ({
    name: pkg.name,
    root: relative(root, pkg.root),
    kind: pkg.kind,
    feature: pkg.feature ?? "",
  })),
};

writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { ArchitectureViolation, ClassifiedPackage, FeatureCatalogueEntry } from "../types.ts";
import { getAnchor } from "../workspace/anchors.ts";
import { listFiles } from "../workspace/layout.ts";
import { sourceText } from "../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";

/** Colocated tests are not the shape they test. */
const TEST_DIRECTORIES = new Set(["__tests__"]);

/**
 * Pieces of the pre-ADR-133 shape the annotation reference no longer has, and the
 * pieces of the reference a feature still lacks.
 */
export const FEATURE_SHAPE_LEGACY_KINDS = [
  "contract-service",
  "persistence-adapter",
  "fixtures-directory",
  "testing-entry",
  "nested-transport",
  "legacy-transport-runtime",
  "unregistered-repositories",
  "unregistered-channels",
  "postgres-without-memory",
  "memory-twin-untested",
  "no-installer",
  "no-app",
  "installer-not-booted",
  "refusing-composition",
  "nested-web-entry",
] as const;

export type FeatureShapeLegacyKind = (typeof FEATURE_SHAPE_LEGACY_KINDS)[number];

export type FeatureShapeFinding = {
  feature: string;
  kind: FeatureShapeLegacyKind;
  /** Workspace-relative path of the file or directory that carries the legacy piece. */
  path: string;
};

type FeatureShapeKey = { feature: string; kind: FeatureShapeLegacyKind };

const TARGET: Record<FeatureShapeLegacyKind, string> = {
  "contract-service":
    "The contract's capability is <feature>.api.ts: the <Feature>Api interface plus its moduleApi token. Delete the abstract service.",
  "persistence-adapter":
    "Persistence is selected by defineRepositories in repositories/<feature>-repositories.registry.ts; the app builds its services from the repositories it is handed. Delete the adapter.",
  "fixtures-directory":
    "Test builders live beside the tests they serve, in app/__tests__/<feature>.fixture.ts.",
  "testing-entry":
    "A server package exports its installer and transport declarations only; tests import doubles from the package's own __tests__ directories.",
  "nested-transport":
    "One flat declaration per protocol: transport/<feature>.rest.ts built with defineRestRouter(<Feature>Api), and transport/<feature>.trpc.ts built with defineTrpcRouter(<Feature>Api, <feature>Trpc) over the contract's <feature>.trpc.ts declaration.",
  "legacy-transport-runtime":
    "A transport is a declaration the process mounts on its runtime: defineRestRouter(<Feature>Api) mounted with createRestRuntime, defineTrpcRouter mounted with createTrpcRuntime. The legacy builders (createVersionedApp, createTrpcService, mountProjectTransport and their kin) are deleted when the last family leaves them.",
  "unregistered-repositories":
    "Add repositories/<feature>-repositories.registry.ts with defineRepositories({ live, memory }) and select it with .withRepositories() in <feature>.server.ts.",
  "unregistered-channels":
    "A channel carries messages the module does not own the state of. Add channels/<feature>-channels.registry.ts exporting { live, memory }, each a class with static readonly requires and static create, and a memory twin under channels/memory/ for every live tier.",
  "postgres-without-memory":
    "Every Prisma repository has a memory twin under repositories/memory/, bundled by memory.<feature>.repositories.ts, so the app is tested without a database.",
  "memory-twin-untested":
    "A memory twin is proven by repositories/__tests__/<x>.repository.contract.test.ts running the same cases against the memory and the Prisma backends; an installation test booting over the twin proves nothing about the twin.",
  "no-installer":
    'The server package is installed through src/<feature>.server.ts: defineServerModule("<feature>").withRepositories(registry).withApp(<Feature>App).withTransports(...).build().',
  "no-app":
    "One app: src/app/<feature>.app.ts is class <Feature>App implements <Feature>Api with static contract, static dependencies, a private constructor and static create(setup).",
  "installer-not-booted":
    "The generated module list is stale relative to the catalogue. Run `pnpm generate:modules` to regenerate packages/installed-server-modules/src/server-modules.generated.ts from modules/catalogue.json, and check in the result.",
  "refusing-composition":
    "A process either installs the feature or does not. Delete the refusing*/absent twin; a missing provider fails boot by name.",
  "nested-web-entry":
    "Public web pieces are flat entries src/<id>.ts exported as ./<id> in the package's own package.json; the screens/ and surfaces/ directories are the older spelling. The package's exports map is the whole declaration — there is no separate catalogue file to register it in.",
};

const COMPOSITION_ROOTS = ["apps/api/src/features", "apps/worker/src/features"];
/** What `pnpm generate:modules` writes from modules/catalogue.json (ARCHITECTURE.md §6). */
const GENERATED_SERVER_MODULE_LIST =
  "packages/installed-server-modules/src/server-modules.generated.ts";
const GENERATED_MODULE_LIST_BLOCK = /export const \w+Modules = \[([\s\S]*?)\] as const/;
const GENERATED_MODULE_LIST_ENTRY = /([A-Za-z0-9_]+)/g;
const REFUSING_EXPORT = /export function refusing/;

/**
 * The builders of the two legacy execution paths. A family that names one still
 * runs through them, however flat its transport folder is.
 */
const LEGACY_TRANSPORT_BUILDER =
  /\b(?:createVersionedApp|createProjectVersionedApp|createServiceVersionedApp|createRestService|createProjectApp|createOrgApp|createServiceApp|createTrpcService|createTrpcApiService|mountProjectTransport|mountProjectRestRouter)\b/;

const PERSISTENCE_ADAPTER = /^(?:postgres|prisma)\.[a-z0-9-]+\.adapter\.ts$/;

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function subdirectories(path: string): string[] {
  if (!isDirectory(path)) return [];

  return readdirSync(path)
    .filter((name) => name !== "__tests__" && isDirectory(join(path, name)))
    .toSorted((a, b) => a.localeCompare(b));
}

function files(path: string): string[] {
  if (!isDirectory(path)) return [];

  return readdirSync(path)
    .filter((name) => isFile(join(path, name)))
    .toSorted((a, b) => a.localeCompare(b));
}

function sourceFiles(path: string): readonly string[] {
  return listFiles({
    directory: path,
    accept: (file) => file.endsWith(".ts"),
    ignoredDirectories: TEST_DIRECTORIES,
  });
}

function pascalCase(feature: string): string {
  return feature
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Every `<x>Server` identifier the generated server list installs, so "installer
 * not booted" means the checked-in list is stale relative to the catalogue.
 */
function bootedInstallers(root: string): Set<string> {
  const path = getAnchor({ root, anchor: GENERATED_SERVER_MODULE_LIST, policy: "feature-shape" });
  const block = GENERATED_MODULE_LIST_BLOCK.exec(sourceText({ file: path }));

  if (!block) {
    throw new Error(`feature-shape: ${GENERATED_SERVER_MODULE_LIST} declares no module list.`);
  }

  return new Set([...block[1]!.matchAll(GENERATED_MODULE_LIST_ENTRY)].map((match) => match[1]!));
}

function isBooted(feature: string, booted: ReadonlySet<string>): boolean {
  const pascal = pascalCase(feature);
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);

  return [...booted].some((name) => name === `${camel}Server` || name.endsWith(`${pascal}Server`));
}

function compareEntries(left: FeatureShapeKey, right: FeatureShapeKey): number {
  return left.feature.localeCompare(right.feature) || left.kind.localeCompare(right.kind);
}

function contractFindings(
  root: string,
  feature: string,
  pkg: ClassifiedPackage,
): FeatureShapeFinding[] {
  const service = join(pkg.root, "src", `${feature}.service.ts`);

  return isFile(service)
    ? [{ feature, kind: "contract-service", path: workspacePath(root, service) }]
    : [];
}

function serverFindings({
  root,
  feature,
  pkg,
  booted,
}: {
  root: string;
  feature: string;
  pkg: ClassifiedPackage;
  booted: ReadonlySet<string>;
}): FeatureShapeFinding[] {
  const src = join(pkg.root, "src");
  const findings: FeatureShapeFinding[] = [];

  const add = (kind: FeatureShapeLegacyKind, path: string): void => {
    findings.push({ feature, kind, path: workspacePath(root, path) });
  };

  const installer = join(src, `${feature}.server.ts`);
  const installed = isFile(installer);
  const bootedSomewhere = installed && isBooted(feature, booted);

  if (!installed) add("no-installer", src);
  else if (!bootedSomewhere) add("installer-not-booted", installer);

  const appMissing = !isFile(join(src, "app", `${feature}.app.ts`));
  if (appMissing) add("no-app", src);

  const adapter = files(join(src, "adapters")).find((name) => PERSISTENCE_ADAPTER.test(name));
  if (adapter) add("persistence-adapter", join(src, "adapters", adapter));

  const fixtures = join(src, "fixtures");
  if (isDirectory(fixtures)) add("fixtures-directory", fixtures);

  const testingEntry = join(src, "testing.ts");
  if (isFile(testingEntry)) add("testing-entry", testingEntry);

  const nested = subdirectories(join(src, "transport"))[0];
  if (nested) add("nested-transport", join(src, "transport", nested));

  const legacyRuntime = sourceFiles(src).find((file) =>
    LEGACY_TRANSPORT_BUILDER.test(sourceText({ file })),
  );

  if (legacyRuntime) add("legacy-transport-runtime", legacyRuntime);

  addRepositoryFindings({ repositories: join(src, "repositories"), add });
  addChannelFindings({ channels: join(src, "channels"), add });

  return findings;
}

function addRepositoryFindings({
  repositories,
  add,
}: {
  repositories: string;
  add: (kind: FeatureShapeLegacyKind, path: string) => void;
}): void {
  if (!isDirectory(repositories)) return;

  const registered = files(repositories).some((name) => name.endsWith(".registry.ts"));
  if (!registered) add("unregistered-repositories", repositories);

  const prisma = join(repositories, "prisma");
  const memory = join(repositories, "memory");
  const memoryTwinMissing = isDirectory(prisma) && !isDirectory(memory);
  if (memoryTwinMissing) add("postgres-without-memory", prisma);

  const contractTested =
    isDirectory(join(memory, "__tests__")) ||
    files(join(repositories, "__tests__")).some((name) => name.endsWith(".contract.test.ts"));

  if (isDirectory(memory) && !contractTested) add("memory-twin-untested", memory);
}

function addChannelFindings({
  channels,
  add,
}: {
  channels: string;
  add: (kind: FeatureShapeLegacyKind, path: string) => void;
}): void {
  if (!isDirectory(channels)) return;

  const registered = files(channels).some((name) => name.endsWith(".registry.ts"));
  if (!registered) add("unregistered-channels", channels);

  const tiers = subdirectories(channels).filter((name) => !TEST_DIRECTORIES.has(name));
  const live = tiers.filter((name) => name !== "memory");
  const [firstLive] = live;
  const twinMissing = firstLive !== undefined && !tiers.includes("memory");
  if (twinMissing) add("unregistered-channels", join(channels, firstLive));
}

function webFindings(root: string, feature: string, pkg: ClassifiedPackage): FeatureShapeFinding[] {
  const src = join(pkg.root, "src");

  return ["screens", "surfaces"].flatMap((name) => {
    const directory = join(src, name);
    const populated = sourceFiles(directory).length > 0;

    return populated
      ? [{ feature, kind: "nested-web-entry" as const, path: workspacePath(root, directory) }]
      : [];
  });
}

function compositionFindings(root: string, feature: string): FeatureShapeFinding[] {
  return COMPOSITION_ROOTS.flatMap((compositionRoot) =>
    sourceFiles(join(root, compositionRoot, feature))
      .filter((file) => REFUSING_EXPORT.test(sourceText({ file })))
      .map((file) => ({
        feature,
        kind: "refusing-composition" as const,
        path: workspacePath(root, file),
      })),
  );
}

/** Every legacy piece a catalogue feature still carries, against the annotation shape. */
export function collectFeatureShapeFindings(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  packages: readonly ClassifiedPackage[],
): FeatureShapeFinding[] {
  const features = new Set(catalogue.map((entry) => entry.id));
  const booted = bootedInstallers(root);
  const composed = new Set<string>();

  return packages
    .flatMap((pkg) => {
      const feature = pkg.feature;
      if (!feature || !features.has(feature)) return [];

      const firstPackageOfFeature = !composed.has(feature);
      composed.add(feature);
      const composition = firstPackageOfFeature ? compositionFindings(root, feature) : [];

      if (pkg.kind === "contract") return [...composition, ...contractFindings(root, feature, pkg)];

      if (pkg.kind === "process") {
        return [...composition, ...serverFindings({ root, feature, pkg, booted })];
      }

      if (pkg.kind === "browser") return [...composition, ...webFindings(root, feature, pkg)];

      return composition;
    })
    .toSorted((left, right) => compareEntries(left, right) || left.path.localeCompare(right.path));
}

/** Every legacy piece is a finding; the reference shape is the only allowance. */
export function lintFeatureShape(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, catalogue, packages } = snapshot;

  return collectFeatureShapeFindings(root, catalogue, packages).map((finding) => ({
    policy: "feature-shape",
    file: join(root, finding.path),
    message: `Feature ${finding.feature} carries a legacy ${finding.kind} the reference shape has no place for.`,
    allowed: TARGET[finding.kind],
  }));
}

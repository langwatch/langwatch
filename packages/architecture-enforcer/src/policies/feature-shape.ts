import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  type BaselineEntry,
  type BaselinePolicy,
  baselinePath,
  collectBaseline,
  emptyBaselineRows,
  liveKeys,
  readBaseline,
  staleRows,
} from "../baseline.ts";
import { walkFiles } from "../workspace/layout.ts";
import { sourceText } from "../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";
import type { ArchitectureViolation, ClassifiedPackage, FeatureCatalogueEntry } from "../types.ts";

const BASELINE_FILE = "feature-shape-baseline.json";

/** Colocated tests are not the shape they test. */
const TEST_DIRECTORIES = new Set(["__tests__"]);

/**
 * Pieces of the pre-ADR-133 shape the annotation reference no longer has, and the
 * pieces of the reference a feature still lacks; the baseline of who carries which
 * may only shrink.
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

type FeatureShapeBaselineEntry = { feature: string; kind: FeatureShapeLegacyKind };

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
    "Add repositories/<feature>-repositories.registry.ts with defineRepositories({ postgres, memory }) and select it with .withRepositories() in <feature>.server.ts.",
  "unregistered-channels":
    "A channel carries messages the module does not own the state of. Add channels/<feature>-channels.registry.ts with defineChannels({ live, memory }) and a memory twin under channels/memory/ for every live tier.",
  "postgres-without-memory":
    "Every Prisma repository has a memory twin under repositories/memory/, bundled by memory.<feature>.repositories.ts, so the app is tested without a database.",
  "memory-twin-untested":
    "A memory twin is proven by repositories/__tests__/<x>.repository.contract.test.ts running the same cases against the memory and the Prisma backends; an installation test booting over the twin proves nothing about the twin.",
  "no-installer":
    'The server package is installed through src/<feature>.server.ts: defineServerModule("<feature>").withRepositories(registry).withApp(<Feature>App).withTransports(...).build().',
  "no-app":
    "One app: src/app/<feature>.app.ts is class <Feature>App implements <Feature>Api with static contract, static dependencies, a private constructor and static create(setup).",
  "installer-not-booted":
    "A process boots the installer: createApp(...).withPersistence(...).withProvided(PeerApi, peer).withModule(<feature>Server).boot() in apps/api, apps/worker or apps/tasks. Delete the hand-built composition.",
  "refusing-composition":
    "A process either installs the feature or does not. Delete the refusing*/absent twin; a missing provider fails boot by name.",
  "nested-web-entry":
    "Public web pieces are flat entries src/<id>.ts exported as ./<id>; the screens/ and surfaces/ directories are the older spelling. A flat entry must be declared in apps/ui/src/features/catalogue.json (uses.screens or uses.surfaces) and its package listed as governed there, or frontend-ui-boundaries refuses the import.",
};

const BOOT_SCAN_ROOTS = [
  "apps/api/src",
  "apps/worker/src",
  "apps/tasks/src",
  "enterprise/packages/composition",
];
const COMPOSITION_ROOTS = ["apps/api/src/features", "apps/worker/src/features"];
const BOOTED_INSTALLER = /withModule\(\s*([A-Za-z0-9_]+)/g;
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
    .sort((a, b) => a.localeCompare(b));
}

function files(path: string): string[] {
  if (!isDirectory(path)) return [];

  return readdirSync(path)
    .filter((name) => isFile(join(path, name)))
    .sort((a, b) => a.localeCompare(b));
}

function sourceFiles(path: string): string[] {
  return walkFiles(path, (file) => file.endsWith(".ts"), { ignoredDirectories: TEST_DIRECTORIES });
}

function pascalCase(feature: string): string {
  return feature
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** Every `<x>Server` identifier a process hands to `withModule(...)`. */
function bootedInstallers(root: string): Set<string> {
  const booted = new Set<string>();

  for (const scanRoot of BOOT_SCAN_ROOTS) {
    for (const file of sourceFiles(join(root, scanRoot))) {
      for (const match of sourceText({ file }).matchAll(BOOTED_INSTALLER)) {
        booted.add(match[1]!);
      }
    }
  }

  return booted;
}

function isBooted(feature: string, booted: ReadonlySet<string>): boolean {
  const pascal = pascalCase(feature);
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);

  return [...booted].some((name) => name === `${camel}Server` || name.endsWith(`${pascal}Server`));
}

function compareEntries(left: FeatureShapeBaselineEntry, right: FeatureShapeBaselineEntry): number {
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

function serverFindings(
  root: string,
  feature: string,
  pkg: ClassifiedPackage,
  booted: ReadonlySet<string>,
): FeatureShapeFinding[] {
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

  const repositories = join(src, "repositories");

  if (isDirectory(repositories)) {
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

  const channels = join(src, "channels");

  if (isDirectory(channels)) {
    const registered = files(channels).some((name) => name.endsWith(".registry.ts"));
    if (!registered) add("unregistered-channels", channels);

    const tiers = subdirectories(channels).filter((name) => !TEST_DIRECTORIES.has(name));
    const live = tiers.filter((name) => name !== "memory");
    const twinMissing = live.length > 0 && !tiers.includes("memory");
    if (twinMissing) add("unregistered-channels", join(channels, live[0]));
  }

  return findings;
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
      if (pkg.layoutVersion !== 0 || !feature || !features.has(feature)) return [];

      const firstPackageOfFeature = !composed.has(feature);
      composed.add(feature);
      const composition = firstPackageOfFeature ? compositionFindings(root, feature) : [];

      if (pkg.kind === "contract") return [...composition, ...contractFindings(root, feature, pkg)];

      if (pkg.kind === "server") {
        return [...composition, ...serverFindings(root, feature, pkg, booted)];
      }

      if (pkg.kind === "web") return [...composition, ...webFindings(root, feature, pkg)];

      return composition;
    })
    .sort((left, right) => compareEntries(left, right) || left.path.localeCompare(right.path));
}

/** The key of a feature-shape row: `<feature>|<kind>`. */
function entryKey(finding: { feature: string; kind: FeatureShapeLegacyKind }): string {
  return `${finding.feature}|${finding.kind}`;
}

export const FEATURE_SHAPE_BASELINE: BaselinePolicy = {
  id: "feature-shape",
  file: BASELINE_FILE,
  label: "Feature shape baseline",
  keyRule: "A key is `<feature>|<kind>`.",
  enforceExpiry: false,
  refuseEmpty: true,
  stale: (entry) => ({
    message: `Feature shape baseline entry ${entry.key.split("|").join("/")} no longer matches anything and must be removed.`,
    allowed: "Delete the stale entry so the checked-in inventory only shrinks.",
  }),
};

export function collectFeatureShapeBaseline({
  root,
  catalogue,
  packages,
  previous = [],
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
  packages: readonly ClassifiedPackage[];
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = collectFeatureShapeFindings(root, catalogue, packages).map(entryKey);

  return collectBaseline({ policy: FEATURE_SHAPE_BASELINE, found, previous });
}

function baselineFile(root: string): string {
  return baselinePath({ root, policy: FEATURE_SHAPE_BASELINE });
}

/**
 * The ratchet: an unlisted legacy piece is a violation, a listed piece that is
 * gone is stale, so the inventory only shrinks.
 */
export function lintFeatureShape(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, catalogue, packages } = snapshot;
  const file = baselineFile(root);
  const baseline = readBaseline({ policy: FEATURE_SHAPE_BASELINE, file });
  const violations = [
    ...baseline.violations,
    ...emptyBaselineRows({ read: baseline, policy: FEATURE_SHAPE_BASELINE, file }),
  ];

  const findings = collectFeatureShapeFindings(root, catalogue, packages);
  const baselined = liveKeys({ entries: baseline.entries });
  const found = new Set(findings.map(entryKey));

  for (const finding of findings) {
    if (baselined.has(entryKey(finding))) continue;

    violations.push({
      policy: "feature-shape",
      file: join(root, finding.path),
      message: `Feature ${finding.feature} carries a legacy ${finding.kind} the reference shape has no place for.`,
      allowed: TARGET[finding.kind],
    });
  }

  violations.push(
    ...staleRows({ entries: baseline.entries, found, policy: FEATURE_SHAPE_BASELINE, file }),
  );

  return violations;
}

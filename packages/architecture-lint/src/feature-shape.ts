import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import type { ArchitectureViolation, ClassifiedPackage, FeatureCatalogueEntry } from "./types.ts";

const BASELINE_FILE = "feature-shape-baseline.json";

/**
 * Pieces of the pre-ADR-133 shape the annotation reference no longer has; the
 * baseline of who still carries which may only shrink.
 */
export const FEATURE_SHAPE_LEGACY_KINDS = [
  "contract-service",
  "persistence-adapter",
  "fixtures-directory",
  "testing-entry",
  "nested-transport",
  "unregistered-repositories",
  "postgres-without-memory",
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
    "The contract's capability is <feature>.api.ts: the <Feature>Api interface plus its featureApi token. Delete the abstract service.",
  "persistence-adapter":
    "Persistence is selected by defineRepositories in repositories/<feature>-repositories.registry.ts; the app builds its services from the repositories it is handed. Delete the adapter.",
  "fixtures-directory":
    "Test builders live beside the tests they serve, in app/__tests__/<feature>.fixture.ts.",
  "testing-entry":
    "A server package exports its installer and transport declarations only; tests import doubles from the package's own __tests__ directories.",
  "nested-transport":
    "One flat declaration per protocol: transport/<feature>.rest.ts and transport/<feature>.trpc.ts built with defineTransport(<Feature>Api).",
  "unregistered-repositories":
    "Add repositories/<feature>-repositories.registry.ts with defineRepositories({ postgres, memory }) and select it with .withRepositories() in <feature>.server.ts.",
  "postgres-without-memory":
    "Every Prisma repository has a memory twin under repositories/memory/, bundled by memory.<feature>.repositories.ts, so the app is tested without a database.",
};

const PERSISTENCE_ADAPTER = /^(?:postgres|prisma)\.[a-z0-9-]+\.adapter\.ts$/;

const entrySchema = z
  .object({
    feature: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    kind: z.enum(FEATURE_SHAPE_LEGACY_KINDS),
  })
  .strict();
const baselineSchema = z.object({ version: z.literal(0), entries: z.array(z.unknown()) }).strict();

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

function compareEntries(left: FeatureShapeBaselineEntry, right: FeatureShapeBaselineEntry): number {
  return left.feature.localeCompare(right.feature) || left.kind.localeCompare(right.kind);
}

function entryKey(entry: FeatureShapeBaselineEntry): string {
  return `${entry.feature}:${entry.kind}`;
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
): FeatureShapeFinding[] {
  const src = join(pkg.root, "src");
  const findings: FeatureShapeFinding[] = [];
  const add = (kind: FeatureShapeLegacyKind, path: string): void => {
    findings.push({ feature, kind, path: workspacePath(root, path) });
  };

  const adapter = files(join(src, "adapters")).find((name) => PERSISTENCE_ADAPTER.test(name));
  if (adapter) add("persistence-adapter", join(src, "adapters", adapter));

  const fixtures = join(src, "fixtures");
  if (isDirectory(fixtures)) add("fixtures-directory", fixtures);

  const testingEntry = join(src, "testing.ts");
  if (isFile(testingEntry)) add("testing-entry", testingEntry);

  const nested = subdirectories(join(src, "transport"))[0];
  if (nested) add("nested-transport", join(src, "transport", nested));

  const repositories = join(src, "repositories");
  if (isDirectory(repositories)) {
    const registered = files(repositories).some((name) => name.endsWith(".registry.ts"));
    if (!registered) add("unregistered-repositories", repositories);

    const prisma = join(repositories, "prisma");
    const memoryTwinMissing = isDirectory(prisma) && !isDirectory(join(repositories, "memory"));
    if (memoryTwinMissing) add("postgres-without-memory", prisma);
  }

  return findings;
}

/** Every legacy piece a catalogue feature still carries, against the annotation shape. */
export function collectFeatureShapeFindings(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  packages: readonly ClassifiedPackage[],
): FeatureShapeFinding[] {
  const features = new Set(catalogue.map((entry) => entry.id));

  return packages
    .flatMap((pkg) => {
      const feature = pkg.feature;
      if (pkg.layoutVersion !== 0 || !feature || !features.has(feature)) return [];

      if (pkg.kind === "contract") return contractFindings(root, feature, pkg);

      if (pkg.kind === "server") return serverFindings(root, feature, pkg);

      return [];
    })
    .sort((left, right) => compareEntries(left, right) || left.path.localeCompare(right.path));
}

export function collectFeatureShapeBaseline(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  packages: readonly ClassifiedPackage[],
): FeatureShapeBaselineEntry[] {
  const entries = new Map<string, FeatureShapeBaselineEntry>();
  for (const { feature, kind } of collectFeatureShapeFindings(root, catalogue, packages)) {
    entries.set(entryKey({ feature, kind }), { feature, kind });
  }

  return [...entries.values()].sort(compareEntries);
}

export function formatFeatureShapeBaseline(entries: readonly FeatureShapeBaselineEntry[]): string {
  const sorted = [...entries].sort(compareEntries);
  const lines = ["{", '  "version": 0,', '  "entries": ['];
  for (const [index, entry] of sorted.entries()) {
    lines.push(`    ${JSON.stringify(entry)}${index + 1 === sorted.length ? "" : ","}`);
  }

  lines.push("  ]", "}");

  return `${lines.join("\n")}\n`;
}

function baselineFile(root: string): string {
  return join(root, "packages/architecture-lint/src", BASELINE_FILE);
}

function baselineViolation(file: string, message: string, allowed?: string): ArchitectureViolation {
  return { policy: "feature-shape-baseline", file, message, allowed };
}

export function readFeatureShapeBaselineFile(file: string): {
  exists: boolean;
  entries: FeatureShapeBaselineEntry[];
  violations: ArchitectureViolation[];
} {
  if (!existsSync(file)) return { exists: false, entries: [], violations: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return {
      exists: true,
      entries: [],
      violations: [baselineViolation(file, `Feature shape baseline must be valid JSON: ${reason}`)],
    };
  }

  const parsed = baselineSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      exists: true,
      entries: [],
      violations: [
        baselineViolation(
          file,
          "Feature shape baseline must contain version 0 and an entries array.",
        ),
      ],
    };
  }

  const violations: ArchitectureViolation[] = [];
  const entries: FeatureShapeBaselineEntry[] = [];
  for (const [index, entry] of parsed.data.entries.entries()) {
    const result = entrySchema.safeParse(entry);
    if (!result.success) {
      violations.push(
        baselineViolation(
          file,
          `Feature shape baseline entry ${index} is malformed.`,
          `Use { feature, kind } with kind one of ${FEATURE_SHAPE_LEGACY_KINDS.join(", ")}.`,
        ),
      );
      continue;
    }

    entries.push(result.data);
  }

  const unsorted = entries.some(
    (entry, index) => index > 0 && compareEntries(entries[index - 1]!, entry) >= 0,
  );
  if (unsorted) {
    violations.push(
      baselineViolation(
        file,
        "Feature shape baseline entries must be unique and sorted by feature, then kind.",
      ),
    );
  }

  return { exists: true, entries, violations };
}

/**
 * The ratchet: an unlisted legacy piece is a violation, a listed piece that is
 * gone is stale, so the inventory only shrinks.
 */
export function lintFeatureShape(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const file = baselineFile(root);
  const baseline = readFeatureShapeBaselineFile(file);
  const violations = [...baseline.violations];
  const emptyBaseline =
    baseline.exists && baseline.entries.length === 0 && baseline.violations.length === 0;
  if (emptyBaseline) {
    violations.push(
      baselineViolation(
        file,
        "An empty feature shape baseline must be deleted rather than kept as an exception surface.",
      ),
    );
  }

  const findings = collectFeatureShapeFindings(root, catalogue, packages);
  const baselined = new Set(baseline.entries.map(entryKey));
  const seen = new Set(findings.map(entryKey));

  for (const finding of findings) {
    const listed = baselined.has(entryKey(finding));
    if (listed) continue;

    violations.push({
      policy: "feature-shape",
      file: join(root, finding.path),
      message: `Feature ${finding.feature} carries a legacy ${finding.kind} the reference shape has no place for.`,
      allowed: TARGET[finding.kind],
    });
  }

  for (const entry of baseline.entries) {
    const stillCarried = seen.has(entryKey(entry));
    if (stillCarried) continue;

    violations.push(
      baselineViolation(
        file,
        `Feature shape baseline entry ${entry.feature}/${entry.kind} no longer matches anything and must be removed.`,
        "Delete the stale entry so the checked-in inventory only shrinks.",
      ),
    );
  }

  return violations;
}

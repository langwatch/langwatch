import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { walkFiles } from "./files";
import type {
  ArchitectureViolation,
  ClassifiedPackage,
  FeatureCatalogueEntry,
} from "./types";

const BASELINE_PATH = join(
  "packages",
  "architecture-lint",
  "src",
  "legacy-feature-fragment-baseline.json",
);
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_SOURCE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const REMNANT_KINDS = [
  "composition",
  "infrastructure-adapter",
  "legacy-implementation",
  "page-shell",
  "transport",
] as const;

export type LegacyFeatureFragmentKind = (typeof REMNANT_KINDS)[number];

export type LegacyFeatureFragment = {
  feature: string;
  file: string;
  kind: LegacyFeatureFragmentKind;
};

type LegacyFeatureFragmentBaseline = {
  version: 0;
  fragments: LegacyFeatureFragment[];
};

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function subjectForms(subject: string): readonly string[] {
  const singular = normalise(subject);
  return [
    singular,
    `${singular}s`,
    `${singular}es`,
    ...(singular.endsWith("y") ? [`${singular.slice(0, -1)}ies`] : []),
  ];
}

function sourceSegments(path: string): readonly string[] {
  return path
    .split("/")
    .map((part) => normalise(part.replace(/\.[^.]+$/, "")))
    .filter(Boolean);
}

function remnantKind(file: string): LegacyFeatureFragmentKind {
  if (file.includes("/runtime/")) return "composition";
  if (
    file.includes("/app/api/") ||
    file.includes("/server/api/routers/") ||
    file.includes("/server/routes/")
  ) {
    return "transport";
  }
  if (
    file.includes("/components/") ||
    file.includes("/hooks/") ||
    file.includes("/pages/")
  ) {
    return "page-shell";
  }
  if (/\.(?:adapter|client)\.[cm]?[jt]sx?$/.test(file)) {
    return "infrastructure-adapter";
  }
  return "legacy-implementation";
}

function fragmentKey(fragment: LegacyFeatureFragment): string {
  return `${fragment.feature}\0${fragment.file}\0${fragment.kind}`;
}

function fragmentFileKey(fragment: LegacyFeatureFragment): string {
  return `${fragment.feature}\0${fragment.file}`;
}

function compareFragments(
  left: LegacyFeatureFragment,
  right: LegacyFeatureFragment,
): number {
  return (
    left.feature.localeCompare(right.feature) ||
    left.file.localeCompare(right.file) ||
    left.kind.localeCompare(right.kind)
  );
}

/**
 * Collects only path-shaped legacy fragments for features which already have a
 * physical canonical surface. The catalogue, rather than English name guessing
 * or source parsing, is the ownership authority. A segment must equal a
 * catalogue subject (or its mechanical plural) to be included.
 */
export function collectLegacyFeatureFragments(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  packages: readonly ClassifiedPackage[],
): LegacyFeatureFragment[] {
  const migratedFeatures = new Set(
    packages.flatMap((pkg) => (pkg.feature ? [pkg.feature] : [])),
  );
  const subjectOwners = catalogue.flatMap((entry) =>
    migratedFeatures.has(entry.id)
      ? entry.subjects.map((subject) => ({
          feature: entry.id,
          forms: new Set(subjectForms(subject)),
        }))
      : [],
  );
  const legacyRoot = join(root, "platform", "app", "src");
  const fragments: LegacyFeatureFragment[] = [];

  for (const file of walkFiles(
    legacyRoot,
    (path) =>
      SOURCE_FILE.test(path) &&
      !TEST_SOURCE.test(path) &&
      !path.includes(`${sep}__tests__${sep}`) &&
      !path.includes(`${sep}__mocks__${sep}`),
  )) {
    const workspaceFile = workspacePath(root, file);
    const segments = sourceSegments(workspaceFile);
    const matchingFeatures = new Set<string>();
    for (const owner of subjectOwners) {
      if (!segments.some((segment) => owner.forms.has(segment))) continue;
      matchingFeatures.add(owner.feature);
    }
    for (const feature of matchingFeatures) {
      fragments.push({
        feature,
        file: workspaceFile,
        kind: remnantKind(workspaceFile),
      });
    }
  }

  return fragments.sort(compareFragments);
}

export function formatLegacyFeatureFragmentBaseline(
  fragments: readonly LegacyFeatureFragment[],
): string {
  const sorted = [...fragments].sort(compareFragments);
  const lines = ["{", '  "version": 0,', '  "fragments": ['];
  for (const [index, fragment] of sorted.entries()) {
    lines.push(
      `    ${JSON.stringify(fragment)}${index + 1 === sorted.length ? "" : ","}`,
    );
  }
  lines.push("  ]", "}");
  return `${lines.join("\n")}\n`;
}

function readBaseline(root: string): {
  baseline: LegacyFeatureFragment[];
  violations: ArchitectureViolation[];
} {
  const path = join(root, BASELINE_PATH);
  if (!existsSync(path)) return { baseline: [], violations: [] };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      baseline: [],
      violations: [
        {
          policy: "legacy-feature-fragment-baseline",
          file: path,
          message: `Legacy feature fragment baseline must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  if (
    typeof value !== "object" ||
    value === null ||
    (value as Partial<LegacyFeatureFragmentBaseline>).version !== 0 ||
    !Array.isArray((value as Partial<LegacyFeatureFragmentBaseline>).fragments)
  ) {
    return {
      baseline: [],
      violations: [
        {
          policy: "legacy-feature-fragment-baseline",
          file: path,
          message:
            "Legacy feature fragment baseline must contain version 0 and a fragments array.",
        },
      ],
    };
  }

  const violations: ArchitectureViolation[] = [];
  const baseline: LegacyFeatureFragment[] = [];
  const entries = (value as LegacyFeatureFragmentBaseline).fragments;
  for (const [index, entry] of entries.entries()) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).length !== 3 ||
      !["feature", "file", "kind"].every(
        (key, keyIndex) => Object.keys(entry)[keyIndex] === key,
      ) ||
      typeof entry.feature !== "string" ||
      typeof entry.file !== "string" ||
      !REMNANT_KINDS.includes(entry.kind)
    ) {
      violations.push({
        policy: "legacy-feature-fragment-baseline",
        file: path,
        message: `Legacy feature fragment baseline entry ${index} is malformed.`,
        allowed: "Use feature, file, and a recognised kind in canonical key order.",
      });
      continue;
    }
    baseline.push(entry);
  }

  if (
    baseline.some(
      (entry, index) => index > 0 && compareFragments(baseline[index - 1]!, entry) > 0,
    )
  ) {
    violations.push({
      policy: "legacy-feature-fragment-baseline",
      file: path,
      message:
        "Legacy feature fragment baseline entries must be sorted by feature, file, and kind.",
    });
  }
  const keys = baseline.map(fragmentFileKey);
  if (new Set(keys).size !== keys.length) {
    violations.push({
      policy: "legacy-feature-fragment-baseline",
      file: path,
      message:
        "Legacy feature fragment baseline contains duplicate feature/file entries.",
    });
  }
  return { baseline, violations };
}

export function lintLegacyFeatureFragments(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const path = join(root, BASELINE_PATH);
  const { baseline, violations } = readBaseline(root);
  const actual = collectLegacyFeatureFragments(root, catalogue, packages);
  if (existsSync(path) && baseline.length === 0 && violations.length === 0) {
    violations.push({
      policy: "legacy-feature-fragment-baseline",
      file: path,
      message:
        "An empty legacy feature fragment baseline must be deleted rather than retained as an exception surface.",
    });
  }

  const actualByKey = new Map(
    actual.map((fragment) => [fragmentKey(fragment), fragment]),
  );
  const baselineByKey = new Map(
    baseline.map((fragment) => [fragmentKey(fragment), fragment]),
  );
  for (const fragment of actual) {
    if (baselineByKey.has(fragmentKey(fragment))) continue;
    violations.push({
      policy: "legacy-feature-fragment",
      file: join(root, fragment.file),
      message: `New legacy ${fragment.feature} fragment is not permitted (${fragment.kind}).`,
      allowed:
        "Move the behaviour to the canonical feature package. A deliberate transport, composition module, page shell, or infrastructure adapter must be recorded explicitly while its inventory only shrinks.",
    });
  }
  for (const fragment of baseline) {
    if (actualByKey.has(fragmentKey(fragment))) continue;
    violations.push({
      policy: "legacy-feature-fragment-baseline",
      file: path,
      message: `Baseline ${fragment.feature} fragment ${JSON.stringify(fragment.file)} no longer exists and must be removed.`,
      allowed: "Delete the stale entry so the checked-in inventory only shrinks.",
    });
  }
  return violations;
}

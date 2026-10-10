import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type {
  ArchitectureViolation,
  FeatureCatalogueEntry,
  FeatureClassification,
} from "../types.ts";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const featureNameSchema = z.string().regex(NAME);
/** A REST path segment: lower-case words joined by `-`, or `_` where a legacy path has one. */
const REST_NAMESPACE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** A non-empty, sorted, duplicate-free list of names the pattern accepts. */
function sortedNamesSchema(pattern: RegExp) {
  return z
    .array(z.string().regex(pattern))
    .min(1)
    .refine((names) => new Set(names).size === names.length)
    .refine((names) =>
      names.every((name, index) => {
        const previous = names[index - 1];
        const comparison = previous?.localeCompare(name);
        const ordered = comparison !== void 0 && comparison < 0;

        return index === 0 || ordered;
      }),
    );
}

const featureSubjectsSchema = sortedNamesSchema(NAME);
const featureCatalogueEntryKeysSchema = z
  .object({
    classification: z.unknown(),
    id: z.unknown(),
    restNamespaces: z.unknown().optional(),
    root: z.unknown(),
    subjects: z.unknown(),
  })
  .strict();
const featureCatalogueEntrySchema = z
  .object({
    classification: z.enum(["core", "enterprise"]),
    id: featureNameSchema,
    /** The first segments after `/api/` (or `/api/v1/`) this feature owns (§8). */
    restNamespaces: sortedNamesSchema(REST_NAMESPACE).optional(),
    root: z.string(),
    subjects: featureSubjectsSchema,
  })
  .strict();
const featureCatalogueSchema = z
  .object({
    features: z.array(z.unknown()),
    version: z.literal(0),
  })
  .passthrough();
const jsonObjectSchema = z.record(z.string(), z.unknown());

function issue(file: string, message: string, allowed?: string): ArchitectureViolation {
  return { policy: "feature-catalogue", file, message, allowed };
}

function expectedRoot(id: string, classification: FeatureClassification): string {
  return classification === "enterprise" ? `enterprise/modules/${id}` : `modules/${id}`;
}

interface SeenCatalogue {
  ids: Set<string>;
  roots: Set<string>;
  subjectOwners: Map<string, string>;
  restNamespaceOwners: Map<string, string>;
}

type ParsedCatalogueEntry = {
  entry: FeatureCatalogueEntry;
  restNamespaces: readonly string[];
};

function parseCatalogueEntry({
  path,
  index,
  raw,
  violations,
}: {
  path: string;
  index: number;
  raw: unknown;
  violations: ArchitectureViolation[];
}): ParsedCatalogueEntry | undefined {
  if (!jsonObjectSchema.validate(raw)) {
    violations.push(issue(path, `Feature catalogue entry ${index} must be an object.`));
    return undefined;
  }

  if (!featureCatalogueEntryKeysSchema.validate(raw)) {
    violations.push(
      issue(
        path,
        `Feature catalogue entry ${index} must contain only id, root, classification, subjects, and restNamespaces.`,
      ),
    );

    return undefined;
  }

  const entryResult = featureCatalogueEntrySchema.safeParse(raw);

  if (!entryResult.success) {
    violations.push(
      issue(
        path,
        `Feature catalogue entry ${index} is malformed.`,
        "Use a singular lower-case kebab-case id, its derived root, a core or enterprise classification, a sorted duplicate-free subjects array, and an optional sorted duplicate-free restNamespaces array.",
      ),
    );

    return undefined;
  }

  const { classification, id, root, subjects, restNamespaces = [] } = entryResult.data;
  return { entry: { id, root, classification, subjects }, restNamespaces };
}

function checkRestNamespaces({
  path,
  parsed,
  seen,
  violations,
}: {
  path: string;
  parsed: ParsedCatalogueEntry;
  seen: SeenCatalogue;
  violations: ArchitectureViolation[];
}): void {
  const { id } = parsed.entry;

  for (const namespace of parsed.restNamespaces) {
    const owner = seen.restNamespaceOwners.get(namespace);

    if (owner && owner !== id) {
      violations.push(
        issue(
          path,
          `REST namespace ${JSON.stringify(namespace)} is owned by both ${JSON.stringify(owner)} and ${JSON.stringify(id)}.`,
          "Give each REST namespace one owner; the other module serves its paths with .withSharedPath({ owner }). See dev/docs/ARCHITECTURE.md §8.",
        ),
      );
    } else {
      seen.restNamespaceOwners.set(namespace, id);
    }
  }
}

function checkCatalogueEntry({
  path,
  entry,
  seen,
  violations,
}: {
  path: string;
  entry: FeatureCatalogueEntry;
  seen: SeenCatalogue;
  violations: ArchitectureViolation[];
}): void {
  const { classification, id, root, subjects } = entry;
  const expected = expectedRoot(id, classification);

  if (root !== expected) {
    violations.push(
      issue(
        path,
        `Feature ${JSON.stringify(id)} must use root ${JSON.stringify(expected)}, found ${JSON.stringify(root)}.`,
      ),
    );
  }

  if (seen.ids.has(id)) {
    violations.push(issue(path, `Feature id ${JSON.stringify(id)} is declared more than once.`));
  }

  if (seen.roots.has(root)) {
    violations.push(
      issue(path, `Feature root ${JSON.stringify(root)} is declared more than once.`),
    );
  }

  seen.ids.add(id);
  seen.roots.add(root);

  for (const subject of subjects) {
    const owner = seen.subjectOwners.get(subject);

    if (owner && owner !== id) {
      violations.push(
        issue(
          path,
          `Subject ${JSON.stringify(subject)} is owned by both ${JSON.stringify(owner)} and ${JSON.stringify(id)}.`,
        ),
      );
    } else {
      seen.subjectOwners.set(subject, id);
    }
  }
}

type ReadCatalogue = {
  entries: FeatureCatalogueEntry[];
  restNamespaceOwners: ReadonlyMap<string, string>;
};

const NOTHING_READ: ReadCatalogue = { entries: [], restNamespaceOwners: new Map() };

export function readFeatureCatalogue(
  workspaceRoot: string,
  violations: ArchitectureViolation[],
): FeatureCatalogueEntry[] {
  return readCatalogue({ workspaceRoot, violations }).entries;
}

/** Which feature owns each REST namespace, from the same catalogue (§8). */
export function readRestNamespaceOwners({
  workspaceRoot,
  violations = [],
}: {
  workspaceRoot: string;
  violations?: ArchitectureViolation[];
}): ReadonlyMap<string, string> {
  return readCatalogue({ workspaceRoot, violations }).restNamespaceOwners;
}

function readCatalogue({
  workspaceRoot,
  violations,
}: {
  workspaceRoot: string;
  violations: ArchitectureViolation[];
}): ReadCatalogue {
  const path = join(workspaceRoot, "modules", "catalogue.json");

  if (!existsSync(path)) {
    violations.push(
      issue(
        path,
        "The repository must declare its singular feature ownership catalogue.",
        "Add modules/catalogue.json with version 0 and its core and Enterprise feature entries.",
      ),
    );

    return NOTHING_READ;
  }

  let rawCatalogue: unknown;

  try {
    rawCatalogue = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    violations.push(
      issue(
        path,
        `Feature catalogue must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );

    return NOTHING_READ;
  }

  const catalogueResult = featureCatalogueSchema.safeParse(rawCatalogue);

  if (!catalogueResult.success) {
    violations.push(issue(path, "Feature catalogue must contain version 0 and a features array."));

    return NOTHING_READ;
  }

  const entries: FeatureCatalogueEntry[] = [];

  const seen: SeenCatalogue = {
    ids: new Set<string>(),
    roots: new Set<string>(),
    subjectOwners: new Map<string, string>(),
    restNamespaceOwners: new Map<string, string>(),
  };

  for (const [index, raw] of catalogueResult.data.features.entries()) {
    const parsed = parseCatalogueEntry({ path, index, raw, violations });
    if (!parsed) continue;
    checkCatalogueEntry({ path, entry: parsed.entry, seen, violations });
    checkRestNamespaces({ path, parsed, seen, violations });
    entries.push(parsed.entry);
  }

  const sorted = [...entries].toSorted((left, right) => {
    const classificationOrder =
      Number(left.classification === "enterprise") - Number(right.classification === "enterprise");

    return classificationOrder || left.id.localeCompare(right.id);
  });

  if (!sorted.every((entry, index) => entry.id === entries[index]?.id)) {
    violations.push(
      issue(
        path,
        "Feature catalogue entries must be sorted by classification (core first) and then id.",
      ),
    );
  }

  return { entries, restNamespaceOwners: seen.restNamespaceOwners };
}

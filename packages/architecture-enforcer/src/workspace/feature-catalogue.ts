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
const featureSubjectsSchema = z
  .array(featureNameSchema)
  .min(1)
  .refine((subjects) => new Set(subjects).size === subjects.length)
  .refine((subjects) =>
    subjects.every((subject, index) => {
      const previous = subjects[index - 1];
      const comparison = previous?.localeCompare(subject);
      const ordered = comparison !== void 0 && comparison < 0;

      return index === 0 || ordered;
    }),
  );
const featureCatalogueEntryKeysSchema = z
  .object({
    classification: z.unknown(),
    id: z.unknown(),
    root: z.unknown(),
    subjects: z.unknown(),
  })
  .strict();
const featureCatalogueEntrySchema = z
  .object({
    classification: z.enum(["core", "enterprise"]),
    id: featureNameSchema,
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
}

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
}): FeatureCatalogueEntry | undefined {
  if (!jsonObjectSchema.validate(raw)) {
    violations.push(issue(path, `Feature catalogue entry ${index} must be an object.`));
    return undefined;
  }

  if (!featureCatalogueEntryKeysSchema.validate(raw)) {
    violations.push(
      issue(
        path,
        `Feature catalogue entry ${index} must contain only id, root, classification, and subjects.`,
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
        "Use a singular lower-case kebab-case id, its derived root, a core or enterprise classification, and a sorted duplicate-free subjects array.",
      ),
    );

    return undefined;
  }

  const { classification, id, root, subjects } = entryResult.data;
  return { id, root, classification, subjects };
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

export function readFeatureCatalogue(
  workspaceRoot: string,
  violations: ArchitectureViolation[],
): FeatureCatalogueEntry[] {
  const path = join(workspaceRoot, "modules", "catalogue.json");

  if (!existsSync(path)) {
    violations.push(
      issue(
        path,
        "The repository must declare its singular feature ownership catalogue.",
        "Add modules/catalogue.json with version 0 and its core and Enterprise feature entries.",
      ),
    );

    return [];
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

    return [];
  }

  const catalogueResult = featureCatalogueSchema.safeParse(rawCatalogue);

  if (!catalogueResult.success) {
    violations.push(issue(path, "Feature catalogue must contain version 0 and a features array."));

    return [];
  }

  const entries: FeatureCatalogueEntry[] = [];

  const seen: SeenCatalogue = {
    ids: new Set<string>(),
    roots: new Set<string>(),
    subjectOwners: new Map<string, string>(),
  };

  for (const [index, raw] of catalogueResult.data.features.entries()) {
    const entry = parseCatalogueEntry({ path, index, raw, violations });
    if (!entry) continue;
    checkCatalogueEntry({ path, entry, seen, violations });
    entries.push(entry);
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

  return entries;
}

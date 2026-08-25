import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ArchitectureViolation,
  FeatureCatalogueEntry,
  FeatureClassification,
} from "./types";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENTRY_KEYS = ["classification", "id", "root", "subjects"] as const;

function issue(file: string, message: string, allowed?: string): ArchitectureViolation {
  return { policy: "feature-catalogue", file, message, allowed };
}

function expectedRoot(id: string, classification: FeatureClassification): string {
  return classification === "enterprise"
    ? `packages/enterprise/features/${id}`
    : `packages/features/${id}`;
}

export function readFeatureCatalogue(
  workspaceRoot: string,
  violations: ArchitectureViolation[],
): FeatureCatalogueEntry[] {
  const path = join(workspaceRoot, "packages", "features", "catalogue.json");
  if (!existsSync(path)) {
    violations.push(
      issue(
        path,
        "The repository must declare its singular feature ownership catalogue.",
        "Add packages/features/catalogue.json with version 0 and its core and Enterprise feature entries.",
      ),
    );
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    violations.push(
      issue(
        path,
        `Feature catalogue must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return [];
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 0 ||
    !Array.isArray((parsed as { features?: unknown }).features)
  ) {
    violations.push(
      issue(path, "Feature catalogue must contain version 0 and a features array."),
    );
    return [];
  }

  const entries: FeatureCatalogueEntry[] = [];
  const ids = new Set<string>();
  const roots = new Set<string>();
  const subjectOwners = new Map<string, string>();
  const rawFeatures = (parsed as { features: unknown[] }).features;

  for (const [index, raw] of rawFeatures.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      violations.push(issue(path, `Feature catalogue entry ${index} must be an object.`));
      continue;
    }
    const value = raw as Record<string, unknown>;
    const keys = Object.keys(value).sort();
    if (
      keys.length !== ENTRY_KEYS.length ||
      !ENTRY_KEYS.every((key, keyIndex) => key === keys[keyIndex])
    ) {
      violations.push(
        issue(
          path,
          `Feature catalogue entry ${index} must contain only id, root, classification, and subjects.`,
        ),
      );
      continue;
    }

    const id = value.id;
    const classification = value.classification;
    const root = value.root;
    const subjects = value.subjects;
    if (
      typeof id !== "string" ||
      !NAME.test(id) ||
      (classification !== "core" && classification !== "enterprise") ||
      typeof root !== "string" ||
      !Array.isArray(subjects) ||
      subjects.length === 0 ||
      !subjects.every((subject) => typeof subject === "string" && NAME.test(subject)) ||
      new Set(subjects).size !== subjects.length ||
      ![...subjects]
        .sort()
        .every((subject, subjectIndex) => subject === subjects[subjectIndex])
    ) {
      violations.push(
        issue(
          path,
          `Feature catalogue entry ${index} is malformed.`,
          "Use a singular lower-case kebab-case id, its derived root, a core or enterprise classification, and a sorted duplicate-free subjects array.",
        ),
      );
      continue;
    }

    const expected = expectedRoot(id, classification);
    if (root !== expected) {
      violations.push(
        issue(
          path,
          `Feature ${JSON.stringify(id)} must use root ${JSON.stringify(expected)}, found ${JSON.stringify(root)}.`,
        ),
      );
    }
    if (ids.has(id)) {
      violations.push(
        issue(path, `Feature id ${JSON.stringify(id)} is declared more than once.`),
      );
    }
    if (roots.has(root)) {
      violations.push(
        issue(path, `Feature root ${JSON.stringify(root)} is declared more than once.`),
      );
    }
    ids.add(id);
    roots.add(root);

    for (const subject of subjects as string[]) {
      const owner = subjectOwners.get(subject);
      if (owner && owner !== id) {
        violations.push(
          issue(
            path,
            `Subject ${JSON.stringify(subject)} is owned by both ${JSON.stringify(owner)} and ${JSON.stringify(id)}.`,
          ),
        );
      } else {
        subjectOwners.set(subject, id);
      }
    }

    entries.push({
      id,
      root,
      classification,
      subjects: subjects as string[],
    });
  }

  const sorted = [...entries].sort((left, right) => {
    const classificationOrder =
      Number(left.classification === "enterprise") -
      Number(right.classification === "enterprise");
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

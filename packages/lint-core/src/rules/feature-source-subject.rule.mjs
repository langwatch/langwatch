import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SUBJECT_ARTIFACT,
  claimedSubjects,
  claimsSubject,
} from "../../grammar/feature-layout-policy.mjs";
import { defineRule } from "../define-rule.mjs";

const subjectOwnerCache = new Map();

/**
 * Which feature owns each subject, for the features that have a physical
 * package. Dormant catalogue entries are migration intent, not a demand for
 * placeholder packages, so they own nothing yet.
 */
function subjectOwners(cwd) {
  if (subjectOwnerCache.has(cwd)) return subjectOwnerCache.get(cwd);
  const owners = new Map();
  const file = join(cwd, "packages", "features", "catalogue.json");
  const migrated = new Set();
  for (const featuresRoot of [
    join(cwd, "packages", "features"),
    join(cwd, "packages", "enterprise", "features"),
  ]) {
    if (!existsSync(featuresRoot)) continue;
    // A feature is "migrated" once it has any physical contract/server/web
    // package; that is the same fact `loadWorkspace` computes for
    // package-boundaries, kept local here to avoid a cross-rule dependency.
    for (const entry of readEntries(featuresRoot)) {
      for (const role of ["contract", "server", "web"]) {
        if (existsSync(join(featuresRoot, entry, role, "package.json"))) {
          migrated.add(entry);
          break;
        }
      }
    }
  }
  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      for (const entry of value.features ?? []) {
        if (!migrated.has(entry.id)) continue;
        for (const subject of entry.subjects ?? []) owners.set(subject, entry.id);
      }
    } catch {
      owners.clear();
    }
  }
  subjectOwnerCache.set(cwd, owners);
  return owners;
}

function readEntries(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** The owner of `candidate`, other than `feature` itself, or undefined. */
function foreignOwnerOf(owners, candidate, feature) {
  const direct = owners.get(candidate);
  if (direct && direct !== feature) return [candidate, direct];
  if (candidate.startsWith(`${feature}-`)) {
    const stripped = candidate.slice(feature.length + 1);
    const strippedOwner = owners.get(stripped);
    if (strippedOwner && strippedOwner !== feature) return [stripped, strippedOwner];
  }
  return undefined;
}

export const featureSourceSubjectRule = defineRule({
  name: "feature-source-subject",
  kind: "problem",
  messages: {
    foreignSubject: {
      what: "Source module {{path}} claims {{subject}}, which belongs to the singular {{owner}} feature.",
      fix: "Move the file into `packages/features/{{owner}}/…` (see the `feature-move` skill), or rename the subject if it is genuinely different.",
    },
  },
  create(context, file) {
    const source = file.strictSource;
    if (!source || (source.role !== "contract" && source.role !== "server")) return {};
    if (source.sourcePath === "index.ts") return {};
    if (!SUBJECT_ARTIFACT.test(source.sourcePath)) return {};

    const owners = subjectOwners(context.cwd);
    let match;
    for (const candidate of claimedSubjects(source.sourcePath)) {
      match = foreignOwnerOf(owners, candidate, source.feature);
      // `claimsSubject` also allows `${feature}-${subject}`; matching that
      // form here would require rescanning every catalogue subject, which is
      // exactly the O(subjects) work the Map lookup above replaces. The
      // rarely-taken alternate shape falls back to the exhaustive check.
      if (!match) {
        match = [...owners].find(
          ([subject, owner]) =>
            owner !== source.feature && claimsSubject(candidate, source.feature, subject),
        );
      }
      if (match) break;
    }
    if (!match) return {};
    const [subject, owner] = match;

    return {
      Program(node) {
        context.report({
          node,
          messageId: "foreignSubject",
          data: { path: source.sourcePath, subject, owner },
        });
      },
    };
  },
});

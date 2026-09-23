import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SUBJECT_ARTIFACT,
  claimedSubjects,
  claimsSubject,
} from "../../grammar/feature-layout-policy.mjs";
import { defineRule } from "../define-rule.mjs";

const subjectOwnerCache = new Map();

/**
 * Subject to `{ id, root }` of its owning module, from `modules/catalogue.json`.
 * An entry whose `root` is not on disk yet is intent, not a module, so it owns nothing.
 */
function subjectOwners(cwd) {
  if (subjectOwnerCache.has(cwd)) return subjectOwnerCache.get(cwd);
  const owners = new Map();
  const file = join(cwd, "modules", "catalogue.json");
  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      for (const entry of value.features ?? []) {
        if (typeof entry.root !== "string" || !existsSync(join(cwd, entry.root))) continue;
        for (const subject of entry.subjects ?? []) {
          owners.set(subject, { id: entry.id, root: entry.root });
        }
      }
    } catch {
      owners.clear();
    }
  }
  subjectOwnerCache.set(cwd, owners);
  return owners;
}

/** The owner of `candidate`, other than `feature` itself, or undefined. */
function foreignOwnerOf(owners, candidate, feature) {
  const direct = owners.get(candidate);
  if (direct && direct.id !== feature) return [candidate, direct];
  if (candidate.startsWith(`${feature}-`)) {
    const stripped = candidate.slice(feature.length + 1);
    const strippedOwner = owners.get(stripped);
    if (strippedOwner && strippedOwner.id !== feature) return [stripped, strippedOwner];
  }
  return undefined;
}

export const featureSourceSubjectRule = defineRule({
  name: "feature-source-subject",
  kind: "problem",
  messages: {
    foreignSubject: {
      what: "Source module {{path}} claims {{subject}}, which the catalogue gives to the {{owner}} module.",
      fix: "Move the file to `{{ownerRoot}}/{{role}}/src/{{path}}`, or rename the subject if it is genuinely different.",
    },
  },
  create(context, file) {
    const source = file.strictSource;
    if (!source || (source.role !== "contract" && source.role !== "process")) return {};
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
            owner.id !== source.feature && claimsSubject(candidate, source.feature, subject),
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
          data: {
            path: source.sourcePath,
            subject,
            owner: owner.id,
            ownerRoot: owner.root,
            role: source.role,
          },
        });
      },
    };
  },
});

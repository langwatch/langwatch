import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { WorkspaceSnapshot } from "./workspace/snapshot.ts";
import type { ArchitectureViolation, FeatureCatalogueEntry } from "./types.ts";

/**
 * A feature that reads runtime configuration declares it once, in its own
 * contract, and no application declares a second reading of the same variable.
 *
 * Two applications that each bind `IS_SAAS` at their own leaf, with their own
 * schema, is how one deployment ends up with two answers to one question. The
 * check is over environment BINDINGS rather than imports because that is the
 * thing that must be unique: a variable has one owner, and every process reads
 * it through that owner's schema.
 */
const APPLICATION_CONFIG_DIRECTORIES = [
  join("apps", "api", "src", "platform", "config"),
  join("apps", "worker", "src", "platform", "config"),
  join("apps", "tasks", "src", "platform", "config"),
];

/**
 * A binding, not a label. `{ env: "NEXTAUTH_URL", value }` in the self-ingest
 * guard's deployment-address list names a variable so a refusal can print it;
 * it reads nothing, so it does not claim ownership.
 */
const ENV_BINDING = /\benv:\s*"([A-Z0-9_]+)"\s*(?!,\s*value\b)/g;
const CONFIG_MODULE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.config\.ts$/;

function issue(file: string, message: string, allowed?: string): ArchitectureViolation {
  return { policy: "feature-configuration", file, message, allowed };
}

function camelCase(featureId: string): string {
  return featureId.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

function bindingsIn(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(ENV_BINDING)].map((match) => match[1] ?? "");
}

function featureConfigModules(root: string, feature: FeatureCatalogueEntry): string[] {
  const directory = join(root, feature.root, "contract", "src");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => CONFIG_MODULE.test(name))
    .map((name) => join(directory, name));
}

export function lintFeatureConfiguration(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, catalogue } = snapshot;
  const violations: ArchitectureViolation[] = [];
  const owners = new Map<string, string>();

  for (const feature of catalogue) {
    for (const file of featureConfigModules(root, feature)) {
      const expected = join(root, feature.root, "contract", "src", `${feature.id}.config.ts`);
      if (file !== expected) continue;

      const source = readFileSync(file, "utf8");
      const name = camelCase(feature.id);
      const declaresSchema =
        source.includes(`export const ${name}ServerConfigSchema`) ||
        source.includes(`export const ${name}WebConfigSchema`);
      if (!declaresSchema) {
        violations.push(
          issue(
            file,
            "A feature configuration module must export the schema its half is validated by.",
            `Export ${name}ServerConfigSchema, ${name}WebConfigSchema, or both.`,
          ),
        );
      }

      for (const binding of bindingsIn(file)) {
        const owner = owners.get(binding);
        if (owner !== undefined && owner !== file) {
          violations.push(
            issue(
              file,
              `${binding} is already declared by ${relative(root, owner)}.`,
              "One environment variable has one owning feature. Read the owner's leaf instead of binding it a second time.",
            ),
          );
          continue;
        }
        owners.set(binding, file);
      }
    }
  }

  for (const directory of APPLICATION_CONFIG_DIRECTORIES) {
    const absolute = join(root, directory);
    if (!existsSync(absolute)) continue;

    for (const name of readdirSync(absolute)) {
      if (!name.endsWith(".config.ts")) continue;

      const file = join(absolute, name);
      for (const binding of bindingsIn(file)) {
        const owner = owners.get(binding);
        if (owner === undefined) continue;
        violations.push(
          issue(
            file,
            `${binding} is declared by ${relative(root, owner)} and read again here.`,
            "Spread the feature's own configuration definition into this section instead of declaring a second leaf for the same variable.",
          ),
        );
      }
    }
  }

  return violations;
}

import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../types.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";

/**
 * A module's configuration is declared once, in its contract's `<name>.config.ts`, as one
 * `Config.define` (ARCHITECTURE.md §6). One owner per environment variable is boot's
 * `config_collision`; `static readonly configSchema` is counted by deleted-spellings-in-code.
 */
const SOURCE = /\.tsx?$/;
const TEST_SOURCE = /(?:^|[\\/])__(?:tests|mocks)__[\\/]|\.(?:test|spec)\.tsx?$/;
const CONFIG_DECLARATION = /\bConfig\.define\s*\(/;
const DELETED_SCHEMA = /\bexport\s+const\s+(\w+(?:Server|App)ConfigSchema)\b/;
const HALVES = ["contract", "process", "browser", "client"] as const;

function issue({
  file,
  message,
  allowed,
}: {
  file: string;
  message: string;
  allowed: string;
}): ArchitectureViolation {
  return { policy: "feature-configuration", file, message, allowed };
}

function moduleSources({
  snapshot,
  feature,
}: {
  snapshot: WorkspaceSnapshot;
  feature: FeatureCatalogueEntry;
}): string[] {
  return HALVES.flatMap((half) =>
    snapshot.files({
      directory: join(snapshot.root, feature.root, half, "src"),
      accept: (path) => SOURCE.test(path) && !TEST_SOURCE.test(path),
    }),
  );
}

function lintModuleSource({
  root,
  feature,
  file,
}: {
  root: string;
  feature: FeatureCatalogueEntry;
  file: string;
}): ArchitectureViolation[] {
  const source = readFileSync(file, "utf8");
  const home = join(root, feature.root, "contract", "src", `${feature.id}.config.ts`);
  const violations: ArchitectureViolation[] = [];

  if (file !== home && CONFIG_DECLARATION.test(source)) {
    violations.push(
      issue({
        file,
        message: `${relative(root, file).split(sep).join("/")} declares configuration with Config.define outside ${feature.id}'s contract config module.`,
        allowed: `Move the leaves into the one Config.define in ${relative(root, home).split(sep).join("/")}; the module class attaches it as static readonly config.`,
      }),
    );
  }

  const deleted = DELETED_SCHEMA.exec(source);
  if (deleted) {
    violations.push(
      issue({
        file,
        message: `${deleted[1]} is a deleted spelling (ARCHITECTURE.md §15): a module's config is one Config.define, not a hand-exported schema.`,
        allowed: `Declare the leaves with Config.define in ${relative(root, home).split(sep).join("/")} and attach it as static readonly config.`,
      }),
    );
  }

  return violations;
}

export function lintFeatureConfiguration(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, catalogue } = snapshot;

  return catalogue.flatMap((feature) =>
    moduleSources({ snapshot, feature }).flatMap((file) =>
      lintModuleSource({ root, feature, file }),
    ),
  );
}

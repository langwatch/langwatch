import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";
import { walkFiles } from "./files";

const BASELINE_FILE = "port-module-baseline.json";

export type StrictPortBaselineCheck = {
  violations: ArchitectureViolation[];
  bootstrapped: boolean;
};

const strictPortPathSchema = z
  .string()
  .regex(/^packages\/(?:enterprise\/)?features\/[^/]+\/server\/src\/ports\/.+\.port\.ts$/);

const strictPortBaselineSchema = z
  .object({
    version: z.literal(0),
    ports: z.array(strictPortPathSchema),
  })
  .strict()
  .superRefine((baseline, context) => {
    const ports = new Set<string>();

    for (const [index, port] of baseline.ports.entries()) {
      if (ports.has(port)) {
        context.addIssue({
          code: "custom",
          message: `duplicate port ${port}`,
          path: ["ports", index],
        });
      }

      ports.add(port);

      const previous = baseline.ports[index - 1];
      const comparison = previous?.localeCompare(port);
      const ordered = comparison !== void 0 && comparison < 0;
      if (index > 0 && !ordered) {
        context.addIssue({
          code: "custom",
          message: "ports must be sorted",
          path: ["ports", index],
        });
      }
    }
  });

function isStrictPort(path: string): boolean {
  return /\/server\/src\/ports\/.+\.port\.ts$/.test(path);
}

function hasOnlyExportedAbstractPortClasses(path: string): boolean {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    false,
  );
  let hasPort = false;
  for (const statement of source.statements) {
    const isTypeDeclaration =
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement);
    const isValueDeclaration =
      ts.isFunctionDeclaration(statement) || ts.isEnumDeclaration(statement);
    const named = isTypeDeclaration || isValueDeclaration;
    if (!named || !statement.name?.text.endsWith("Port")) {
      continue;
    }
    const modifiers = statement.modifiers ?? [];
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    hasPort = true;
    if (
      !ts.isClassDeclaration(statement) ||
      !modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword)
    ) {
      return false;
    }
  }
  return hasPort;
}

function baselineFile(root: string): string {
  return join(root, "packages/architecture-lint/src", BASELINE_FILE);
}

export function readStrictPortBaselineFile(file: string): {
  exists: boolean;
  ports: string[];
  violations: ArchitectureViolation[];
} {
  if (!existsSync(file)) {
    return { exists: false, ports: [], violations: [] };
  }

  let rawBaseline: unknown;
  try {
    rawBaseline = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      exists: true,
      ports: [],
      violations: [
        {
          policy: "strict-port-baseline",
          file,
          message: `Strict port baseline must be valid: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const result = strictPortBaselineSchema.safeParse(rawBaseline);
  if (!result.success) {
    const reason = result.error.issues.at(0)?.message ?? "invalid baseline";

    return {
      exists: true,
      ports: [],
      violations: [
        {
          policy: "strict-port-baseline",
          file,
          message: `Strict port baseline must be valid: ${reason}`,
        },
      ],
    };
  }

  return { exists: true, ports: result.data.ports, violations: [] };
}

export function lintStrictPortBaseline(
  root: string,
  baselineReference?: string,
): StrictPortBaselineCheck {
  const currentFile = baselineFile(root);
  const current = readStrictPortBaselineFile(currentFile);
  const violations = [...current.violations];
  if (baselineReference && !current.exists) {
    violations.push({
      policy: "strict-port-baseline",
      file: currentFile,
      message: "Strict port baseline must be checked in before it can be compared.",
      allowed:
        "Commit the reviewed baseline once, then future merge-base checks may only shrink it.",
    });
  }
  if (!baselineReference) {
    return { violations, bootstrapped: false };
  }

  const reference = readStrictPortBaselineFile(resolve(root, baselineReference));
  violations.push(...reference.violations);
  if (!reference.exists) {
    return { violations, bootstrapped: current.exists };
  }
  const referencePorts = new Set(reference.ports);
  for (const port of current.ports) {
    if (!referencePorts.has(port)) {
      violations.push({
        policy: "strict-port-baseline-growth",
        file: currentFile,
        message: `Strict port baseline cannot add ${port}.`,
        allowed: "Convert the port to an abstract Port class instead.",
      });
    }
  }
  return { violations, bootstrapped: false };
}

/**
 * Strict feature ports are nominal abstract classes. The temporary inventory
 * admits only pre-existing type-bag ports and becomes stale as each is fixed.
 */
export function lintStrictPortModules(
  root: string,
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  const baselineResult = readStrictPortBaselineFile(baselineFile(root));
  const baseline = new Set(baselineResult.ports);
  const violations = [...baselineResult.violations];
  const seen = new Set<string>();

  for (const pkg of packages) {
    if (pkg.kind !== "server" || pkg.layoutVersion !== 0) {
      continue;
    }
    for (const file of walkFiles(pkg.root, isStrictPort)) {
      const filePath = relative(root, file).replaceAll("\\", "/");
      seen.add(filePath);
      const valid = hasOnlyExportedAbstractPortClasses(file);
      if (baseline.has(filePath)) {
        if (valid) {
          violations.push({
            policy: "strict-port-baseline",
            file,
            message: "Strict port baseline entry is stale.",
            allowed: "Delete the entry after converting the port to an abstract Port class.",
          });
        }
        continue;
      }
      if (!valid) {
        violations.push({
          policy: "strict-port-module",
          file,
          message:
            "A strict feature port module must export an abstract class whose name ends in Port.",
          allowed:
            "Keep portable supporting types, but model the runtime boundary as an abstract Port class.",
        });
      }
    }
  }

  for (const port of baseline) {
    if (!seen.has(port)) {
      violations.push({
        policy: "strict-port-baseline",
        file: baselineFile(root),
        message: `Strict port baseline entry ${port} no longer has a matching port module.`,
        allowed: "Delete stale entries; the inventory only shrinks.",
      });
    }
  }
  return violations;
}

/** Collects the exact legacy port modules that still need nominal classes. */
export function collectStrictPortBaseline(root: string, packages: ClassifiedPackage[]): string[] {
  return packages
    .filter((pkg) => pkg.kind === "server" && pkg.layoutVersion === 0)
    .flatMap((pkg) => walkFiles(pkg.root, isStrictPort))
    .filter((file) => !hasOnlyExportedAbstractPortClasses(file))
    .map((file) => relative(root, file).replaceAll("\\", "/"))
    .sort((a, b) => a.localeCompare(b));
}

export function formatStrictPortBaseline(ports: string[]): string {
  return `${JSON.stringify({ version: 0, ports }, null, 2)}\n`;
}

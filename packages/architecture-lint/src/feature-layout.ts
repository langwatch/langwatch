import { relative, sep } from "node:path";
import { walkFiles } from "./files";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

const NAME = "[a-z0-9]+(?:-[a-z0-9]+)*";
const CONTRACT_ARTIFACT = new RegExp(
  `^${NAME}\\.(?:commands|errors|events|queries|service)\\.ts$`,
);
const SERVER_ONLY_CONTRACT_ARTIFACT =
  /\.(?:adapter|api|mapper|migration|port|projection|repository|store)\.ts$/;
const CONTRACT_ARTIFACT_SUFFIX =
  /\.(?:commands|errors|events|queries|service)\.ts$/;

const SERVER_PATTERNS = [
  /^index\.ts$/,
  /^testing\.ts$/,
  new RegExp(`^services/${NAME}\\.service\\.ts$`),
  new RegExp(`^ports/${NAME}\\.port\\.ts$`),
  new RegExp(`^repositories/${NAME}\\.repository\\.ts$`),
  new RegExp(
    `^repositories/(${NAME})/\\1\\.${NAME}\\.(?:mapper|repository)\\.ts$`,
  ),
  new RegExp(`^stores/${NAME}\\.store\\.ts$`),
  new RegExp(`^stores/(${NAME})/\\1\\.${NAME}\\.store\\.ts$`),
  new RegExp(`^projections/${NAME}\\.projection\\.ts$`),
  new RegExp(`^adapters/${NAME}\\.${NAME}\\.adapter\\.ts$`),
  new RegExp(`^api/${NAME}/${NAME}\\.api\\.ts$`),
  new RegExp(`^migrations/${NAME}-import\\.${NAME}\\.migration\\.ts$`),
] as const;

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function violation(
  file: string,
  message: string,
  allowed: string,
): ArchitectureViolation {
  return { policy: "feature-source-layout", file, message, allowed };
}

function lintContract(pkg: ClassifiedPackage): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const files = walkFiles(`${pkg.root}/src`, (path) =>
    /\.[cm]?[jt]sx?$/.test(path),
  );
  let serviceCount = 0;

  for (const file of files) {
    const path = workspacePath(`${pkg.root}/src`, file);
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name === "index.ts") continue;

    if (/^(?:commands|errors|events|queries|service)\.ts$/.test(name)) {
      violations.push(
        violation(
          file,
          `Contract artifact ${JSON.stringify(name)} is missing its subject.`,
          "Use <subject>.<artifact>.ts, for example agent.service.ts.",
        ),
      );
      continue;
    }
    if (SERVER_ONLY_CONTRACT_ARTIFACT.test(name)) {
      violations.push(
        violation(
          file,
          `Server artifact ${JSON.stringify(name)} cannot live in contract source.`,
          "Move runtime implementations to the matching server/src directory.",
        ),
      );
      continue;
    }
    if (CONTRACT_ARTIFACT_SUFFIX.test(name)) {
      if (!CONTRACT_ARTIFACT.test(name)) {
        violations.push(
          violation(
            file,
            `Contract artifact filename ${JSON.stringify(name)} is not lower-case kebab case.`,
            "Use <subject>.<artifact>.ts.",
          ),
        );
      } else if (name.endsWith(".service.ts")) {
        serviceCount += 1;
      }
    }
  }

  if (serviceCount === 0) {
    violations.push(
      violation(
        `${pkg.root}/src`,
        "A strict contract package must declare its service capability in a subject-named module.",
        "Add src/<subject>.service.ts and export it from src/index.ts.",
      ),
    );
  }
  return violations;
}

function lintServer(pkg: ClassifiedPackage): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const files = walkFiles(`${pkg.root}/src`, (path) =>
    /\.[cm]?[jt]sx?$/.test(path),
  );
  let serviceCount = 0;

  for (const file of files) {
    const path = workspacePath(`${pkg.root}/src`, file);
    if (SERVER_PATTERNS.some((pattern) => pattern.test(path))) {
      if (/^services\/.+\.service\.ts$/.test(path)) serviceCount += 1;
      continue;
    }
    violations.push(
      violation(
        file,
        `Server source path ${JSON.stringify(path)} is not part of strict layout version 0.`,
        "Use services, repositories, stores, projections, ports, adapters, api/<surface>, or migrations with the canonical filename grammar.",
      ),
    );
  }

  if (serviceCount === 0) {
    violations.push(
      violation(
        `${pkg.root}/src/services`,
        "A strict server package must contain a subject-named service class module.",
        "Add src/services/<subject>.service.ts.",
      ),
    );
  }
  return violations;
}

export function lintFeatureLayouts(
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const pkg of packages) {
    if (pkg.layoutVersion !== 0) continue;
    if (pkg.kind === "contract") violations.push(...lintContract(pkg));
    if (pkg.kind === "server") violations.push(...lintServer(pkg));
  }
  return violations;
}

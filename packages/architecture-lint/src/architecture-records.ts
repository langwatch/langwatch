import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

const REQUIRED_SECTIONS = [
  "Context",
  "Decision",
  "Public surfaces and transports",
  "Dependencies",
  "Persistence",
  "Runtime and registration",
  "Environment and configuration",
  "Errors",
  "Contracts and validation",
  "Consequences",
] as const;

const MINIMUM_SECTION_WORDS = 8;

function architectureRoot(pkg: ClassifiedPackage): string {
  if (pkg.feature) return dirname(pkg.root);
  return pkg.root;
}

function markdownFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort();
}

function sectionBody(content: string, section: string): string | undefined {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(
      `^#{2,3} ${escaped}\\s*$([\\s\\S]*?)(?=^#{2,3} |(?![\\s\\S]))`,
      "m",
    ),
  );
  return match?.[1];
}

function hasEnoughInformation(body: string): boolean {
  if (/\b(?:not applicable|does not apply)\b/i.test(body)) return true;
  const prose = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, " ");
  return (
    (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).length >=
    MINIMUM_SECTION_WORDS
  );
}

export function lintArchitectureRecords(
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const roots = new Set(packages.map(architectureRoot));

  for (const root of roots) {
    const adrs = join(root, "adrs");
    const specs = join(root, "specs");
    const index = join(adrs, "README.md");
    const records = markdownFiles(adrs);
    const featureSpecs = existsSync(specs)
      ? readdirSync(specs).filter((file) => file.endsWith(".feature"))
      : [];

    if (!existsSync(index)) {
      violations.push({
        policy: "architecture-record",
        file: index,
        message:
          "Every governed package ownership root must have an ADR index.",
      });
    }
    if (records.length === 0) {
      violations.push({
        policy: "architecture-record",
        file: adrs,
        message:
          "Every governed package ownership root must have a boundary ADR.",
      });
      continue;
    }
    if (featureSpecs.length === 0) {
      violations.push({
        policy: "architecture-record",
        file: specs,
        message:
          "Every documented feature boundary must own at least one Gherkin spec.",
      });
    }

    const boundaryName = records[0];
    if (!boundaryName) continue;
    const boundaryRecord = join(adrs, boundaryName);
    const content = readFileSync(boundaryRecord, "utf8");
    for (const section of REQUIRED_SECTIONS) {
      const body = sectionBody(content, section);
      if (body === undefined) {
        violations.push({
          policy: "architecture-record",
          file: boundaryRecord,
          message: `Boundary ADR must contain a "${section}" section, even when the decision is that the concern does not apply.`,
        });
      } else if (!hasEnoughInformation(body)) {
        violations.push({
          policy: "architecture-record",
          file: boundaryRecord,
          message: `Boundary ADR section "${section}" is too thin to record the package decision; explain the constraint or state why it does not apply.`,
        });
      }
    }
    if (!/\*\*Status:\*\*\s+\S+/.test(content)) {
      violations.push({
        policy: "architecture-record",
        file: boundaryRecord,
        message: "Boundary ADR must declare its status.",
      });
    }
    if (!/\.feature(?:\)|\s|$)/.test(content)) {
      violations.push({
        policy: "architecture-record",
        file: boundaryRecord,
        message: "Boundary ADR must link to its executable .feature contract.",
      });
    }
    if (existsSync(index)) {
      const indexContent = readFileSync(index, "utf8");
      if (!indexContent.includes(boundaryName)) {
        violations.push({
          policy: "architecture-record",
          file: index,
          message: `ADR index must link ${JSON.stringify(boundaryName)}.`,
        });
      }
    }
  }

  return violations;
}

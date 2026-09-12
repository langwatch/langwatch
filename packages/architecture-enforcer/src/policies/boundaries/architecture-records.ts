import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import type { ArchitectureViolation, ClassifiedPackage } from "../../types.ts";

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
    new RegExp(`^#{2,3} ${escaped}\\s*$([\\s\\S]*?)(?=^#{2,3} |(?![\\s\\S]))`, "m"),
  );

  return match?.[1];
}

/** Required-section violations for one ownership root's boundary ADR. */
function boundaryRecordSectionViolations(
  boundaryRecord: string,
  content: string,
): ArchitectureViolation[] {
  return REQUIRED_SECTIONS.filter((section) => sectionBody(content, section) === undefined).map(
    (section) => ({
      policy: "architecture-record",
      file: boundaryRecord,
      message: `Boundary ADR must contain a "${section}" section, even when the decision is that the concern does not apply.`,
    }),
  );
}

/** Status, spec-link, and index-registration violations for one ownership root's boundary ADR. */
function boundaryRecordShapeViolations(options: {
  boundaryRecord: string;
  boundaryName: string;
  content: string;
  index: string;
}): ArchitectureViolation[] {
  const { boundaryRecord, boundaryName, content, index } = options;
  const violations: ArchitectureViolation[] = [];

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

  const indexLinksBoundary =
    existsSync(index) && readFileSync(index, "utf8").includes(boundaryName);
  if (existsSync(index) && !indexLinksBoundary) {
    violations.push({
      policy: "architecture-record",
      file: index,
      message: `ADR index must link ${JSON.stringify(boundaryName)}.`,
    });
  }

  return violations;
}

/** Every architecture-record violation for one non-application package ownership root. */
function violationsForRoot(root: string): ArchitectureViolation[] {
  const adrs = join(root, "adrs");
  const specs = join(root, "specs");
  const index = join(adrs, "README.md");
  const records = markdownFiles(adrs);
  const featureSpecs = existsSync(specs)
    ? readdirSync(specs).filter((file) => file.endsWith(".feature"))
    : [];
  const violations: ArchitectureViolation[] = [];

  if (!existsSync(index)) {
    violations.push({
      policy: "architecture-record",
      file: index,
      message: "Every governed package ownership root must have an ADR index.",
    });
  }

  if (records.length === 0) {
    violations.push({
      policy: "architecture-record",
      file: adrs,
      message: "Every governed package ownership root must have a boundary ADR.",
    });

    return violations;
  }

  if (featureSpecs.length === 0) {
    violations.push({
      policy: "architecture-record",
      file: specs,
      message: "Every documented feature boundary must own at least one Gherkin spec.",
    });
  }

  const boundaryName = records[0];
  if (!boundaryName) return violations;

  const boundaryRecord = join(adrs, boundaryName);
  const content = readFileSync(boundaryRecord, "utf8");

  return [
    ...violations,
    ...boundaryRecordSectionViolations(boundaryRecord, content),
    ...boundaryRecordShapeViolations({ boundaryRecord, boundaryName, content, index }),
  ];
}

export function lintArchitectureRecords(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const packages = snapshot.packages;

  // Applications are composition and deployment roots documented by the
  // repository-level application ADR/spec. Package-local records belong to
  // reusable ownership boundaries, not each executable wrapper.
  const roots = new Map<string, string | undefined>();
  for (const pkg of packages) {
    if (pkg.kind === "application") continue;

    const root = architectureRoot(pkg);
    if (!roots.has(root)) roots.set(root, pkg.feature);
  }

  return [...roots.keys()].flatMap((root) => violationsForRoot(root));
}

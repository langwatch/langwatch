import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import type { ArchitectureViolation, ClassifiedPackage } from "../../types.ts";

const configSchema = z.object({
  references: z.array(z.object({ path: z.string() })).optional(),
  compilerOptions: z
    .object({
      emitDeclarationOnly: z.boolean().optional(),
      noEmit: z.boolean().optional(),
    })
    .optional(),
  langwatchDeclarationGroup: z
    .object({
      members: z.array(z.object({ directory: z.string() })),
    })
    .optional(),
});

type Project = {
  file: string;
  config: z.infer<typeof configSchema>;
  references: string[];
};

function configPath(path: string): string {
  const absolute = resolve(path);
  const isDirectory = existsSync(absolute) && statSync(absolute).isDirectory();

  return isDirectory ? join(absolute, "tsconfig.json") : absolute;
}

function projectGraph(root: string, violations: ArchitectureViolation[]): Map<string, Project> {
  const projects = new Map<string, Project>();
  const visited = new Set<string>();
  const active = new Set<string>();

  const visit = (file: string, referringFile: string): void => {
    if (active.has(file)) {
      violations.push({
        policy: "declaration-project-references",
        file: referringFile,
        message: `Declaration project references form a cycle through ${relative(root, file)}.`,
      });

      return;
    }

    if (visited.has(file)) return;

    visited.add(file);

    if (!existsSync(file)) {
      violations.push({
        policy: "declaration-project-references",
        file: referringFile,
        message: `Declaration project reference does not exist: ${relative(root, file)}.`,
      });

      return;
    }

    const parsed = ts.parseConfigFileTextToJson(file, readFileSync(file, "utf8"));
    const result = configSchema.safeParse(parsed.config);
    if (parsed.error || !result.success) {
      violations.push({
        policy: "declaration-project-references",
        file,
        message: "Declaration project config must contain valid JSONC and project references.",
      });

      return;
    }

    const references = (result.data.references ?? []).map(({ path }) =>
      configPath(resolve(dirname(file), path)),
    );
    projects.set(file, { file, config: result.data, references });
    active.add(file);
    for (const target of references) visit(target, file);

    active.delete(file);
  };

  const solution = join(root, "dev/tsconfig.declarations.json");
  if (existsSync(solution)) visit(solution, solution);

  return projects;
}

function reachableProjects(start: string, projects: ReadonlyMap<string, Project>): Set<string> {
  const result = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || result.has(current)) continue;

    result.add(current);
    pending.push(...(projects.get(current)?.references ?? []));
  }

  return result;
}

function producerDirectories(projects: ReadonlyMap<string, Project>): Map<string, string> {
  const producerByDirectory = new Map<string, string>();
  for (const project of projects.values()) {
    const options = project.config.compilerOptions;
    if (!options?.emitDeclarationOnly || options.noEmit === true) continue;

    producerByDirectory.set(dirname(project.file), project.file);
    for (const member of project.config.langwatchDeclarationGroup?.members ?? []) {
      producerByDirectory.set(resolve(dirname(project.file), member.directory), project.file);
    }
  }

  return producerByDirectory;
}

/** Producer references determine preparation; no-emit consumer references cannot replace them. */
export function lintDeclarationProjectReferences(
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  const { root, packages } = snapshot;

  const violations: ArchitectureViolation[] = [];
  const projects = projectGraph(root, violations);
  const producerByDirectory = producerDirectories(projects);

  const producerByName = new Map(
    packages.map((pkg) => [pkg.name, producerByDirectory.get(pkg.root)]),
  );
  const reachableByProducer = new Map<string, Set<string>>();
  for (const pkg of packages) {
    const producer = producerByName.get(pkg.name);
    if (!producer) continue;

    let reachable = reachableByProducer.get(producer);
    if (!reachable) {
      reachable = reachableProjects(producer, projects);
      reachableByProducer.set(producer, reachable);
    }

    const dependencies = {
      ...pkg.manifest.dependencies,
      ...pkg.manifest.optionalDependencies,
      ...pkg.manifest.peerDependencies,
    };
    for (const name of Object.keys(dependencies)) {
      const dependencyProducer = producerByName.get(name);
      if (!dependencyProducer || reachable.has(dependencyProducer)) continue;

      violations.push({
        policy: "declaration-project-references",
        file: producer,
        specifier: name,
        message: `${pkg.name}'s declaration producer does not prepare this production dependency; missing outputs can pull implementation source into TypeScript consumers.`,
        allowed: `Reference ${relative(root, dependencyProducer)} directly or through another project.`,
      });
    }
  }

  return violations;
}

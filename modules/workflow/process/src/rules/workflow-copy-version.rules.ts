import {
  dslWithoutHttpCredentials,
  parseStudioWorkflow,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";

/** The next major version a copy takes, counted from its OWN history. */
export function nextMajorVersion(current: string | null | undefined): string {
  const [versionMajor] = (current ?? "0.0").split(".");

  return `${parseInt(versionMajor ?? "0") + 1}`;
}

/** Deep-clones a persisted graph so the caller may mutate it freely. */
export function cloneDsl(dsl: unknown): StudioWorkflow {
  return parseStudioWorkflow(JSON.parse(JSON.stringify(dsl)));
}

/** A graph cloned for a copy: into another project, every HTTP credential is blank. */
export function cloneDslForCopy(input: {
  dsl: unknown;
  sourceProjectId: string;
  targetProjectId: string;
}): StudioWorkflow {
  const dsl = cloneDsl(input.dsl);

  return input.sourceProjectId === input.targetProjectId ? dsl : dslWithoutHttpCredentials(dsl);
}

import type { ModelDefaultScope } from "@langwatch/model-provider-contract";

/** A project's default-model lookup order: the project, then its team, then its organization. */
export function projectChain(input: {
  projectId: string;
  teamId: string | null;
  organizationId: string | null;
}): ModelDefaultScope[] {
  return [
    { scopeType: "PROJECT", scopeId: input.projectId },
    ...(input.teamId ? [{ scopeType: "TEAM" as const, scopeId: input.teamId }] : []),
    ...(input.organizationId
      ? [{ scopeType: "ORGANIZATION" as const, scopeId: input.organizationId }]
      : []),
  ];
}

/** The scopes a default set at `reference` inherits from, most specific first. */
export function inheritedChain(input: {
  reference: ModelDefaultScope;
  available: { projects: { id: string; teamId: string }[] };
  organizationId: string | null;
}): ModelDefaultScope[] {
  const { reference, available, organizationId } = input;
  if (reference.scopeType === "ORGANIZATION") {
    return [reference];
  }

  const chain = [reference];
  if (reference.scopeType === "PROJECT") {
    const project = available.projects.find((candidate) => candidate.id === reference.scopeId);
    if (project?.teamId) {
      chain.push({ scopeType: "TEAM", scopeId: project.teamId });
    }
  }

  if (organizationId) {
    chain.push({ scopeType: "ORGANIZATION", scopeId: organizationId });
  }

  return chain;
}

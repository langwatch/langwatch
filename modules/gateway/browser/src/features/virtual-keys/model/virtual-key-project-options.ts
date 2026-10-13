import { NON_DESTINATION_PROJECT_KINDS } from "@langwatch/project-contract";

type TeamWithProjects = {
  id: string;
  name: string;
  projects: readonly { id: string; name: string; kind?: string | null }[];
};

export type VirtualKeyProjectOption = { id: string; name: string; teamId: string };

/**
 * The projects a virtual key may belong to or send its traces to. A project
 * that receives no traces (the governance project, an aggregate per ADR-177)
 * is never offered: the server refuses one anyway.
 */
export function virtualKeyProjectOptions(
  teams: readonly TeamWithProjects[] | null | undefined,
): VirtualKeyProjectOption[] {
  return (teams ?? []).flatMap((team) =>
    team.projects
      .filter((project) => !NON_DESTINATION_PROJECT_KINDS.includes(project.kind ?? ""))
      .map((project) => ({ id: project.id, name: project.name, teamId: team.id })),
  );
}

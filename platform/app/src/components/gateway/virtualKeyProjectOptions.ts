import { NON_DESTINATION_PROJECT_KINDS } from "~/server/app-layer/projects/project-kinds";

interface TeamWithProjects {
  id: string;
  name: string;
  projects: Array<{ id: string; name: string; kind?: string | null }>;
}

export interface VirtualKeyProjectOption {
  id: string;
  name: string;
  teamId: string;
}

/**
 * The projects a virtual key may belong to or send its traces to. A key's
 * traces land in its project, so a project that receives no traces (the
 * governance project, an aggregate per ADR-144) is never offered; the server
 * refuses one anyway, and offering it would only set up that refusal.
 */
export function virtualKeyProjectOptions(
  teams: readonly TeamWithProjects[] | null | undefined,
): VirtualKeyProjectOption[] {
  return (teams ?? []).flatMap((team) =>
    team.projects
      .filter(
        (project) =>
          !NON_DESTINATION_PROJECT_KINDS.includes(project.kind ?? ""),
      )
      .map((project) => ({
        id: project.id,
        name: `${project.name} · ${team.name}`,
        teamId: team.id,
      })),
  );
}

import chalk from "chalk";

import {
  ProjectsApiService,
  type Project,
} from "@/client-sdk/services/projects/projects-api.service";
import { TeamsApiService, type Team } from "@/client-sdk/services/teams/teams-api.service";

import { commandValidationError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";
import { pickByReference, ReferenceNotResolvedError } from "../../utils/pickByReference";
import { runManagement } from "../management/_shared";

/** Largest page the listings answer, so a lookup takes as few requests as it can. */
const PAGE_LIMIT = 100;

/** Every page of a paginated listing, walked to the end. */
const allPages = async <T>(
  fetchPage: (page: number) => Promise<{ data: T[]; pagination: { total: number; limit: number } }>,
): Promise<T[]> => {
  const first = await fetchPage(1);
  const rows = [...first.data];
  const pages = Math.ceil(first.pagination.total / Math.max(first.pagination.limit, 1));
  for (let page = 2; page <= pages; page++) {
    rows.push(...(await fetchPage(page)).data);
  }
  return rows;
};

/** The project and team a move names, or a validation refusal saying which one was not found. */
const resolveTarget = ({
  projectRows,
  teamRows,
  projectReference,
  teamReference,
}: {
  projectRows: readonly Project[];
  teamRows: readonly Team[];
  projectReference: string;
  teamReference: string;
}): { project: Project; team: Team } => {
  try {
    return {
      project: pickByReference({
        rows: projectRows,
        reference: projectReference,
        what: "project",
        scope: "organization",
        listCommand: "langwatch projects list",
      }),
      team: pickByReference({
        rows: teamRows,
        reference: teamReference,
        what: "team",
        scope: "organization",
        listCommand: "langwatch teams list",
      }),
    };
  } catch (error) {
    if (!(error instanceof ReferenceNotResolvedError)) throw error;
    throw Object.assign(new Error(error.message), commandValidationError(error.message));
  }
};

/**
 * `langwatch projects move <project> --team <team>`, each given by id, slug or
 * name. The platform runs the same checks as the project settings screen, and
 * the gateway re-resolves the budgets of the keys tracing to the project.
 */
export const moveProjectCommand = async ({
  project: projectReference,
  team: teamReference,
}: {
  project: string;
  team: string;
}): Promise<CommandResult | void> => {
  let target: { project: Project; team: Team } | undefined;

  return runManagement({
    action: "move project",
    pending: `Moving project "${projectReference}" to team "${teamReference}"...`,
    run: async () => {
      const projects = new ProjectsApiService();
      const teams = new TeamsApiService();
      const [projectRows, teamRows] = await Promise.all([
        allPages((page) => projects.list({ page, limit: PAGE_LIMIT })),
        allPages((page) => teams.list({ page, limit: PAGE_LIMIT })),
      ]);
      const resolved = resolveTarget({ projectRows, teamRows, projectReference, teamReference });
      target = resolved;
      return projects.update(resolved.project.id, { teamId: resolved.team.id });
    },
    succeed: (moved) =>
      `Moved project "${chalk.cyan(moved.name)}" to team "${chalk.cyan(target?.team.name ?? moved.teamId)}"`,
    table: (moved) => {
      console.log();
      console.log(`${chalk.bold("Project:")}  ${chalk.cyan(moved.name)} ${chalk.gray(moved.id)}`);
      console.log(
        `${chalk.bold("Team:")}     ${chalk.cyan(target?.team.name ?? "")} ${chalk.gray(moved.teamId)}`,
      );
      console.log();
      console.log(
        chalk.gray(
          "Gateway keys sending traces to this project now count against the new team's budgets.",
        ),
      );
      console.log();
    },
  });
};

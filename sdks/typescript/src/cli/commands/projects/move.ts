import chalk from "chalk";

import {
  ProjectsApiService,
  type Project,
} from "@/client-sdk/services/projects/projects-api.service";
import { TeamsApiService, type Team } from "@/client-sdk/services/teams/teams-api.service";

import { commandValidationError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";
import { runManagement } from "../management/_shared";

/** Largest page the listings answer, so a lookup takes as few requests as it can. */
const PAGE_LIMIT = 100;

/** Thrown when a name the user typed matches nothing, or more than one thing. */
class ReferenceNotResolvedError extends Error {}

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

/**
 * The one row a reference names: its id, then its slug, then its name, case
 * insensitive. Two rows sharing a name is a refusal that lists their ids,
 * never a guess.
 */
export const pickByReference = <Row extends { id: string; slug: string; name: string }>({
  rows,
  reference,
  what,
}: {
  rows: readonly Row[];
  reference: string;
  what: "project" | "team";
}): Row => {
  const byId = rows.find((row) => row.id === reference);
  if (byId) return byId;
  const bySlug = rows.find((row) => row.slug === reference);
  if (bySlug) return bySlug;
  const byName = rows.filter((row) => row.name.toLowerCase() === reference.toLowerCase());
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new ReferenceNotResolvedError(
      `More than one ${what} is named "${reference}" (${byName.map((row) => row.id).join(", ")}). Pass the id instead.`,
    );
  }
  throw new ReferenceNotResolvedError(
    `No ${what} with the id, slug or name "${reference}" in this organization. List them with \`langwatch ${what}s list\`.`,
  );
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
      project: pickByReference({ rows: projectRows, reference: projectReference, what: "project" }),
      team: pickByReference({ rows: teamRows, reference: teamReference, what: "team" }),
    };
  } catch (error) {
    if (!(error instanceof ReferenceNotResolvedError)) throw error;
    throw commandValidationError(error.message);
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

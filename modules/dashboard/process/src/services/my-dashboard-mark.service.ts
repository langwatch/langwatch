/**
 * The background step that marks each member's My dashboard made before the mark existed: in each
 * project, the first board a member made under the default name, unless one is marked theirs
 * already. A page of projects at a time, checkpointed after each (dashboards-v2.feature AC163).
 */
import { MY_DASHBOARD_NAME } from "@langwatch/dashboard-contract";
import { PROJECT_ID_PAGE_LIMIT, type ProjectApi } from "@langwatch/project-contract";
import type { MigrationStepReport, MigrationStepRun } from "@langwatch/upgrade/step";

import type { BoardRecord, BoardRepository } from "../repositories/board.repository.ts";

type MarkSummary = { marked: number; wouldMark: number };

type Deps = {
  repository: Pick<BoardRepository, "findBoardsInProjects" | "updateBoard">;
  projects: Pick<ProjectApi, "listAllIds">;
};

export class MyDashboardMarkService {
  readonly #deps: Deps;

  private constructor(deps: Deps) {
    this.#deps = deps;
  }

  static create(deps: Deps): MyDashboardMarkService {
    return new MyDashboardMarkService(deps);
  }

  async runStep({
    checkpoint,
    dryRun,
    signal,
  }: Parameters<MigrationStepRun>[0]): Promise<MigrationStepReport> {
    const resumed = checkpoint.resumeFrom?.afterProjectId;
    const summary: MarkSummary = { marked: 0, wouldMark: 0 };
    let after = typeof resumed === "string" ? resumed : undefined;
    do {
      if (signal.aborted) break;
      const page = await this.#deps.projects.listAllIds({ after, limit: PROJECT_ID_PAGE_LIMIT });
      const boards = await this.#deps.repository.findBoardsInProjects({ projectIds: page.ids });
      const unmarked = unmarkedMyDashboards({ boards });
      if (dryRun) {
        summary.wouldMark += unmarked.length;
      } else {
        for (const board of unmarked) {
          await this.#deps.repository.updateBoard({
            projectId: board.projectId,
            dashboardId: board.id,
            data: { myDashboardOfUserId: board.createdById },
          });
          summary.marked += 1;
        }
        const lastId = page.ids.at(-1);
        if (lastId !== undefined) {
          await checkpoint.save({ report: { ...summary, afterProjectId: lastId } });
        }
      }
      after = page.next ?? undefined;
    } while (after !== undefined);
    return { ...summary, dryRun };
  }
}

/**
 * In each project, oldest first, the first board each member made under the default name, when
 * no board of that project is marked theirs yet.
 */
function unmarkedMyDashboards({
  boards,
}: {
  boards: readonly BoardRecord[];
}): (BoardRecord & { createdById: string })[] {
  const owners = new Set(
    boards.flatMap((board) =>
      board.myDashboardOfUserId ? [`${board.projectId}/${board.myDashboardOfUserId}`] : [],
    ),
  );
  const toMark: (BoardRecord & { createdById: string })[] = [];
  for (const board of boards) {
    const { createdById } = board;
    if (createdById === null || board.name !== MY_DASHBOARD_NAME) continue;
    if (board.myDashboardOfUserId) continue;
    const owner = `${board.projectId}/${createdById}`;
    if (owners.has(owner)) continue;
    owners.add(owner);
    toMark.push({ ...board, createdById });
  }
  return toMark;
}

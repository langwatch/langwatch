/**
 * The board tools over `/api/v1/dashboards`: read, create, rename and delete a Dashboards board,
 * list a board's widgets and delete one. Spec: modules/dashboard/specs/dashboards-v2.feature
 * AC199s.
 */

import {
  type Board,
  createBoard,
  deleteBoard,
  deleteBoardWidget,
  getBoard,
  listBoardWidgets,
  updateBoard,
} from "../langwatch-api-boards.js";

function describeBoard(board: Board): string[] {
  return [
    `**Name**: ${board.name}`,
    `**ID**: ${board.id}`,
    `**Scope**: ${board.scope}`,
    ...(board.description ? [`**Description**: ${board.description}`] : []),
    `**URL**: ${board.platformUrl}`,
  ];
}

export async function handleGetDashboardBoard({ boardId }: { boardId: string }): Promise<string> {
  const board = await getBoard({ boardId });
  return [`# ${board.name}\n`, ...describeBoard(board)].join("\n");
}

export async function handleCreateDashboardBoard({ name }: { name: string }): Promise<string> {
  const board = await createBoard({ name });
  return [
    "Board created.\n",
    ...describeBoard(board),
    "",
    "> Pass the ID to `add_dashboard_widget` to add a widget to it.",
  ].join("\n");
}

export async function handleRenameDashboardBoard({
  boardId,
  name,
  description,
}: {
  boardId: string;
  name?: string;
  description?: string;
}): Promise<string> {
  if (name === undefined && description === undefined) {
    throw new Error("Provide at least one of name or description to change.");
  }
  const board = await updateBoard({
    boardId,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
  });
  return ["Board updated.\n", ...describeBoard(board)].join("\n");
}

export async function handleDeleteDashboardBoard({
  boardId,
}: {
  boardId: string;
}): Promise<string> {
  const deleted = await deleteBoard({ boardId });
  return `Board "${deleted.name}" deleted with its widgets (ID: ${deleted.id}).`;
}

export async function handleListBoardWidgets({ boardId }: { boardId: string }): Promise<string> {
  const { data: widgets } = await listBoardWidgets({ boardId });
  if (widgets.length === 0) return `Board "${boardId}" has no widgets.`;

  return [
    `# Widgets on board ${boardId} (${widgets.length} total)\n`,
    ...widgets.flatMap((widget) => [
      `## ${widget.name}`,
      `**ID**: ${widget.id}`,
      `**Queries**: ${widget.definition.queries.map((query) => query.name).join(", ") || "(none)"}`,
      "",
    ]),
  ].join("\n");
}

export async function handleDeleteDashboardWidget({
  boardId,
  widgetId,
}: {
  boardId: string;
  widgetId: string;
}): Promise<string> {
  await deleteBoardWidget({ boardId, widgetId });
  return `Widget "${widgetId}" deleted from board "${boardId}".`;
}

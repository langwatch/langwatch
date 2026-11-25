/**
 * The From LangWatch boards: catalogue templates rendered live and never stored, so Dashboards
 * opens on useful boards with no setup. A change makes the member's own copy. All have code.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";

import {
  CATALOGUE_TEMPLATES,
  type CatalogueTemplate,
  implementedWidget,
  stackWidgets,
} from "../catalogue/index.ts";
import type { BoardTemplateWidget } from "../templates/index.ts";
import { type LibraryTemplate, templateCardById } from "./template-library.ts";

/**
 * The one From LangWatch list, in order; every surface follows it (the sidebar group and
 * the empty board's cards). Release check, then "Can I trust my numbers?", then where it breaks.
 */
export const CURATED_TEMPLATE_IDS = ["release", "data", "breaks"] as const;

/** What the From LangWatch group is, under its heading's (i) (owner, 2026-11-24). */
export const FROM_LANGWATCH_ABOUT =
  "Dashboards LangWatch made for you. They improve over time. Change one and it becomes your " +
  "own copy.";

/** One From LangWatch board: its template's words and its widgets laid out on the grid. */
export interface CuratedBoard {
  readonly templateId: string;
  readonly name: string;
  readonly job: string;
  readonly reportPrompt: string;
  readonly widgets: readonly BoardTemplateWidget[];
  /** Its card in the library, for the empty board's "Or start from a template". */
  readonly card: LibraryTemplate;
}

function curatedWidgets(template: CatalogueTemplate): BoardTemplateWidget[] {
  return stackWidgets(template.widgets.flatMap((id) => implementedWidget(id) ?? []));
}

function curatedBoard(templateId: string): CuratedBoard[] {
  const template = CATALOGUE_TEMPLATES.find(({ id }) => id === templateId);
  const card = templateCardById(templateId);
  if (!template || !card) return [];
  return [
    {
      templateId,
      name: template.name,
      job: template.job,
      reportPrompt: template.reportPrompt,
      widgets: curatedWidgets(template),
      card,
    },
  ];
}

/** The From LangWatch boards, in their one order. */
export const CURATED_BOARDS: readonly CuratedBoard[] = CURATED_TEMPLATE_IDS.flatMap(curatedBoard);

/** A product's pinned board: its template, and the address it opens at. */
export interface ProductDefaultBoard {
  readonly templateId: string;
  /** `project` opens under the project in view; `organization` opens under no project. */
  readonly at: "project" | "organization";
}

/**
 * The From LangWatch board each product pins first in its Dashboards section; Governance pins
 * none. Org-scope boards open at the organization address, which needs no project in view.
 */
export const PRODUCT_DEFAULT_BOARD_IDS: Readonly<
  Partial<Record<DashboardHomeProduct, ProductDefaultBoard>>
> = {
  "llm-ops": { templateId: "cockpit", at: "project" },
  gateway: { templateId: "gateway-costs", at: "organization" },
  me: { templateId: "coding-costs", at: "organization" },
};

/** The pinned boards, kept out of the From LangWatch group the sidebar lists. */
const PINNED_BOARDS: readonly CuratedBoard[] = Object.values(PRODUCT_DEFAULT_BOARD_IDS).flatMap(
  (pinned) => (pinned === undefined ? [] : curatedBoard(pinned.templateId)),
);

/** One From LangWatch board by its template id; undefined for any other id. */
export function curatedBoardById(templateId: string): CuratedBoard | undefined {
  return [...CURATED_BOARDS, ...PINNED_BOARDS].find((board) => board.templateId === templateId);
}

/**
 * A fresh account, organization and project per dashboards or insights file,
 * plus the board and widgets a scenario starts from, created through the
 * public REST routes with a key bound to that project.
 */

import { dashboardWidgetsPath, type WidgetQuery, type WidgetResource } from "./board-state";
import { APP_BASE, useApiKey, useProject } from "./config";
import { lwPost } from "./langwatch-api";
import { getCliApiKey } from "./local-control-fixture";
import {
  createOrganizationWithProject,
  type SeededProject,
  signUpAndUseAccount,
} from "./seed-organization";

const FRESH_ACCOUNT_PASSWORD = "DashboardsRun!2026";

/**
 * Points the whole process (tRPC, REST, the scenario library's reporting) at
 * a new project of its own, so a scenario's widgets and traces never meet
 * another file's. Call once per file, in `beforeAll`.
 */
export async function seedDashboardsProject({ label }: { label: string }): Promise<SeededProject> {
  const stamp = Date.now().toString(36).slice(-5);
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const cookie = await signUpAndUseAccount({
    name: `Dana ${label}`,
    email: `dana+dashboards-${slug}-${stamp}@acme.test`,
    password: FRESH_ACCOUNT_PASSWORD,
  });
  const seeded = await createOrganizationWithProject({
    cookie,
    orgName: `ACME ${label} ${stamp}`,
    primaryIntent: "LLM_OPS",
    signUpData: { terms: true, usage: "Company" },
    project: { name: "ACME Checkout", language: "python", framework: "langgraph" },
  });
  useProject({ id: seeded.projectId, slug: seeded.projectSlug });
  process.env.LANGWATCH_ENDPOINT = APP_BASE;
  const apiKey = await getCliApiKey();
  process.env.LANGWATCH_API_KEY = apiKey;
  useApiKey(apiKey);
  reportResultsToStableProject();
  console.log(`[dashboards] seeded ${JSON.stringify(seeded)}`);
  return seeded;
}

/**
 * With LANGY_REPORT_API_KEY set, the scenario library's results and spans go
 * to that stable project, while Langy still runs on APP_BASE (README.md
 * "Dashboards and Insights helpers").
 */
function reportResultsToStableProject(): void {
  const apiKey = process.env.LANGY_REPORT_API_KEY;
  if (!apiKey) return;
  const endpoint = process.env.LANGY_REPORT_ENDPOINT;
  if (!endpoint) throw new Error("LANGY_REPORT_ENDPOINT is required with LANGY_REPORT_API_KEY");
  process.env.LANGWATCH_API_KEY = apiKey;
  process.env.LANGWATCH_ENDPOINT = endpoint;
}

/** A dashboard as `POST /api/dashboards` answers it. */
export interface Board {
  id: string;
  name: string;
  platformUrl: string;
}

/** Creates an empty dashboard in the seeded project. */
export async function createBoard({ name }: { name: string }): Promise<Board> {
  return lwPost({ path: "/api/dashboards", body: { name } });
}

/** What a scenario's starting widget is made of. */
export interface WidgetSeed {
  name: string;
  code: string;
  queries: WidgetQuery[];
  description?: string;
}

/** Creating a widget leaves it off every board, so it is placed on `dashboardId` next. */
export async function addWidget({
  dashboardId,
  widget,
}: {
  dashboardId: string;
  widget: WidgetSeed;
}): Promise<WidgetResource> {
  const created: WidgetResource = await lwPost({ path: dashboardWidgetsPath(), body: widget });
  return lwPost({
    path: `${dashboardWidgetsPath()}/${created.id}/dashboard`,
    body: { dashboardId },
  });
}

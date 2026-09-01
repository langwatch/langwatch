/**
 * Where the testing surfaces open in the platform.
 *
 * Two interfaces address the same rows. Agent Testing keeps the run plans and
 * the run sets under `/agent-testing/results`, the test suites under
 * `/agent-testing/suites` and the scenarios on `/agent-testing`; the
 * Simulations pages it replaces keep them all under `/simulations`. Which one a
 * link points at is decided per project by the release flag, so a customer who
 * has the new interface never gets a link into the old one, and a customer who
 * does not never gets a link they cannot open.
 *
 * Every address the platform hands out to the outside (the REST APIs, the
 * scenario library, the CLI, the MCP server, the Langy navigate fallback) is
 * built here, so the two interfaces are written in one file.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";
import { isOnPlatformSet } from "~/server/scenarios/internal-set-id";
import type { SuiteKind } from "./types";

/** The flag that decides which interface a project reads. */
const AGENT_TESTING_FLAG = "release_ui_agent_testing_v2_enabled";

/** The interface a project reads its scenarios and runs in. */
export type TestingInterface = "agent_testing" | "simulations";

/** The results list of Agent Testing, where the run plans and the run sets are. */
const AGENT_TESTING_RESULTS = "/agent-testing/results";

/**
 * How Agent Testing names the run set a code run writes into, in its address.
 * The same prefix `toExternalPlanSlug` writes on the client.
 */
const EXTERNAL_SET_PREFIX = "external:";

/**
 * The interface the project reads.
 *
 * A flag read that fails answers the Simulations pages: it is the interface
 * every project can open, so it is the safe answer. The organization is what
 * a release rule of the flag names, so a caller that does not hold it has it
 * read from the project.
 */
export async function readTestingInterface({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId?: string;
}): Promise<TestingInterface> {
  try {
    const resolvedOrganizationId =
      organizationId ?? (await organizationIdOf(projectId));
    const enabled = await featureFlagService.isEnabled(AGENT_TESTING_FLAG, {
      distinctId: projectId,
      projectId,
      organizationId: resolvedOrganizationId,
    });
    return enabled ? "agent_testing" : "simulations";
  } catch {
    return "simulations";
  }
}

/**
 * The organization a project belongs to. A project never changes
 * organization, so the answer is kept for the life of the process: the
 * scenario library asks for an address on every event it posts.
 */
const organizationIds = new Map<string, Promise<string>>();

function organizationIdOf(projectId: string): Promise<string> {
  const known = organizationIds.get(projectId);
  if (known) return known;
  const read = prisma.project
    .findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    })
    .then((project) => {
      if (!project?.team) throw new Error(`Project ${projectId} not found`);
      return project.team.organizationId;
    });
  read.catch(() => organizationIds.delete(projectId));
  organizationIds.set(projectId, read);
  return read;
}

/** The path a suite opens at, without the project prefix. */
export function suitePath({
  ui,
  slug,
  kind,
}: {
  ui: TestingInterface;
  slug: string;
  kind: SuiteKind;
}): string {
  if (kind === "test_suite") {
    return ui === "agent_testing"
      ? `/agent-testing/suites/${slug}`
      : "/simulations";
  }
  return ui === "agent_testing"
    ? `${AGENT_TESTING_RESULTS}/${slug}`
    : `/simulations/run-plans/${slug}`;
}

/**
 * The path a suite opens at, without the project prefix, for the interface
 * the project reads.
 */
export async function suitePlatformPath({
  projectId,
  organizationId,
  slug,
  kind,
}: {
  projectId: string;
  organizationId: string;
  slug: string;
  kind: SuiteKind;
}): Promise<string> {
  const ui = await readTestingInterface({ projectId, organizationId });
  return suitePath({ ui, slug, kind });
}

/**
 * The path of a run set, without the project prefix.
 *
 * The scenario library appends the batch run id to it to name a run, so the
 * path must stay one the interface reads a batch under. Agent Testing lists a
 * set a code run writes into as a plan of its own; the platform's own sets
 * are listed under their plans, so those open the results list.
 */
export function scenarioSetPath({
  ui,
  scenarioSetId,
}: {
  ui: TestingInterface;
  scenarioSetId: string;
}): string {
  if (ui === "simulations") {
    return `/simulations/${encodeURIComponent(scenarioSetId)}`;
  }
  if (isOnPlatformSet(scenarioSetId)) return AGENT_TESTING_RESULTS;
  return `${AGENT_TESTING_RESULTS}/${EXTERNAL_SET_PREFIX}${encodeURIComponent(
    scenarioSetId,
  )}`;
}

/** The path of one batch run of a set, without the project prefix. */
export function batchRunPath({
  ui,
  scenarioSetId,
  batchRunId,
}: {
  ui: TestingInterface;
  scenarioSetId: string;
  batchRunId: string;
}): string {
  const set = scenarioSetPath({ ui, scenarioSetId });
  // The platform's own sets open the results list, which reads no batch.
  if (set === AGENT_TESTING_RESULTS) return set;
  return `${set}/${encodeURIComponent(batchRunId)}`;
}

/**
 * The path of one scenario run, without the project prefix: the interface's
 * results with the run detail drawer open, the same address the app's own UI
 * produces via `openDrawer("scenarioRunDetail", { scenarioRunId })`.
 */
export function scenarioRunPath({
  ui,
  scenarioRunId,
}: {
  ui: TestingInterface;
  scenarioRunId: string;
}): string {
  const base = ui === "agent_testing" ? AGENT_TESTING_RESULTS : "/simulations";
  return `${base}?drawer.open=scenarioRunDetail&drawer.scenarioRunId=${encodeURIComponent(
    scenarioRunId,
  )}`;
}

/**
 * The path of one scenario, without the project prefix: the interface's
 * scenarios with the editor drawer for that scenario open.
 */
export function scenarioEditorPath({
  ui,
  scenarioId,
}: {
  ui: TestingInterface;
  scenarioId: string;
}): string {
  const id = encodeURIComponent(scenarioId);
  return ui === "agent_testing"
    ? `/agent-testing?drawer.open=agentTestingCaseEditor&drawer.scenarioId=${id}`
    : `/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=${id}`;
}

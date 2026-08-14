/**
 * Shared fixture for the REST redaction suites. Each suite gets its own
 * organization/team/project namespace so the three files stay independent of
 * one another and of ordering.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll } from "vitest";
import {
  type Organization,
  type Prisma,
  type Project,
  type Team,
  type TriggerAction,
  TriggerKind,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";

export const SLACK_WEBHOOK =
  "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX";
export const WEBHOOK_HEADER_VALUE = "Bearer sk-live-abcdefghijklmnop";
export const WEBHOOK_SIGNING_SECRET = "whsec-abcdefghijklmnopqrstuvwxyz";
export const SLACK_BOT_TOKEN = "xoxb-000000000000-abcdefghijkl";
export const ENDPOINT_URL = "https://example.com/hooks/langwatch";

type RequestLike = (
  input: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/** Call inside a describe block: registers beforeAll/afterAll for a dedicated
 *  project and returns the accessors the tests read it through. */
export const registerRedactionProject = (ns: string) => {
  let organization: Organization | undefined;
  let team: Team | undefined;
  let project: Project | undefined;

  const projectId = () => project!.id;

  const headers = () => ({
    "X-Auth-Token": project!.apiKey,
    "Content-Type": "application/json",
  });

  const storeTrigger = (data: {
    name: string;
    action: TriggerAction;
    actionParams: Record<string, unknown>;
  }) =>
    prisma.trigger.create({
      data: {
        id: nanoid(),
        projectId: projectId(),
        filters: JSON.stringify({ "metadata.labels": ["prod"] }),
        triggerKind: TriggerKind.AUTOMATION,
        ...data,
        actionParams: data.actionParams as Prisma.InputJsonValue,
      },
    });

  /** The read-modify-write an integrator performs: read the automation, then
   *  send the delivery configuration back exactly as it arrived. */
  const makeWriteBack = (request: RequestLike) => async (id: string) => {
    const read = (await (
      await request(`/api/triggers/${id}`, { headers: headers() })
    ).json()) as { actionParams: Record<string, unknown> };

    return request(`/api/triggers/${id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ actionParams: read.actionParams }),
    });
  };

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Triggers Redaction Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Triggers Redaction Team",
        slug: `--test-team-${ns}`,
        organizationId: organization!.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Triggers Redaction Project",
        slug: `--test-project-${ns}`,
        teamId: team!.id,
        language: "other",
        framework: "other",
        apiKey: `test-api-key-${ns}`,
      },
    });
  });

  afterAll(async () => {
    if (project) {
      await prisma.trigger.deleteMany({ where: { projectId: projectId() } });
      await prisma.project.delete({ where: { id: project.id } });
    }
    if (team) await prisma.team.delete({ where: { id: team.id } });
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });

  return { projectId, headers, storeTrigger, makeWriteBack };
};

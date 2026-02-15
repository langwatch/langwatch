import type { Organization, PrismaClient, User } from "@prisma/client";
import { IncomingWebhook } from "@slack/webhook";
import { env } from "../../src/env.mjs";
import { prisma } from "../../src/server/db";
import { captureException } from "../../src/utils/posthogErrorCapture";

const DAYS_SINCE_LAST_ALERT = 30;

type OrganizationWithAdmins = Organization & { members: { user: User }[] };

export type PlanLimitNotifierInput = {
  organizationId: string;
  planName: string;
};

const sendSlackNotification = async (
  organization: OrganizationWithAdmins,
  planName: string,
) => {
  const url = process.env.SLACK_PLAN_LIMIT_CHANNEL;
  if (!url) {
    return;
  }

  const webhook = new IncomingWebhook(url);

  try {
    await webhook.send({
      text: `Plan limit reached: ${organization.name}, ${organization?.members[0]?.user?.email}, Plan: ${planName}`,
    });
  } catch (error) {
    captureException(error);
  }
};

const sendHubspotNotification = async (organization: OrganizationWithAdmins) => {
  const hubspotPortalId = process.env.HUBSPOT_PORTAL_ID;
  const hubspotFormId = process.env.HUBSPOT_REACHED_LIMIT_FORM_ID;

  if (!hubspotPortalId || !hubspotFormId) {
    return;
  }

  const formData = {
    submittedAt: Date.now(),
    fields: [
      {
        objectTypeId: "0-1",
        name: "firstname",
        value: organization.members[0]?.user?.name,
      },
      {
        objectTypeId: "0-1",
        name: "company",
        value: organization.name,
      },
      {
        objectTypeId: "0-1",
        name: "email",
        value: organization.members[0]?.user?.email,
      },
    ],
    context: {
      pageUri: "app.langwatch.ai",
      pageName: "Plan Limit Reached",
    },
  };

  const url = `https://api.hsforms.com/submissions/v3/integration/submit/${hubspotPortalId}/${hubspotFormId}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      captureException(new Error(`HubSpot request failed: ${response.status}`));
    }
  } catch (error) {
    captureException(error);
  }
};

const updatePlanLimitMessages = async (
  db: PrismaClient,
  organizationId: string,
) => {
  await db.organization.update({
    where: { id: organizationId },
    data: {
      sentPlanLimitAlert: new Date(),
    },
  });
};

export const createPlanLimitNotifier = (db: PrismaClient = prisma) => {
  return async ({ organizationId, planName }: PlanLimitNotifierInput) => {
    if (!env.IS_SAAS) {
      return;
    }

    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      include: {
        members: {
          where: { role: "ADMIN" },
          include: {
            user: true,
          },
        },
      },
    });

    if (!organization) {
      return;
    }

    if (organization.sentPlanLimitAlert) {
      const timeSinceLastAlert =
        Date.now() - organization.sentPlanLimitAlert.getTime();
      const daysSinceLastAlert = Math.floor(
        timeSinceLastAlert / (1000 * 60 * 60 * 24),
      );

      if (daysSinceLastAlert < DAYS_SINCE_LAST_ALERT) {
        return;
      }
    }

    try {
      await updatePlanLimitMessages(db, organizationId);
    } catch (error) {
      captureException(error);
    }

    try {
      await Promise.allSettled([
        sendSlackNotification(organization, planName),
        sendHubspotNotification(organization),
      ]);
    } catch (error) {
      captureException(error);
    }
  };
};

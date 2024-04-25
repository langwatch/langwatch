import { IncomingWebhook } from "@slack/webhook";
import { Client } from "@hubspot/api-client";
import * as Sentry from "../langwatch/langwatch/node_modules/@sentry/nextjs";

const sendSlackNotification = async (user: any, org: any) => {
  const url = process.env.SLACK_CHANNEL_SIGNUPS!;
  const webhook = new IncomingWebhook(url);

  try {
    await webhook.send({
      text: `🔔 New user registered: ${user.name}, ${user.email}. Organization: ${org.orgName}, ${org.phoneNumber}`,
    });
  } catch (err) {
    Sentry.captureException(err);
  }
};

const createLeadInHubSpot = async (user: any, org: any) => {
  const leadData = {
    properties: {
      firstname: user.name,
      email: user.email,
      phone: org.phoneNumber,
      company: org.orgName,
    },
  };

  const hubspotApiKey = process.env.HUBSPOT_API_KEY!;
  const hubspotClient = new Client({ accessToken: hubspotApiKey });

  try {
    // @ts-ignore
    await hubspotClient.crm.contacts.basicApi.create(leadData);
  } catch (err) {
    Sentry.captureException(err);
  }
};

export const PostRegistrationCallback = async (user: any, org: any) => {
  const slackNotificationPromise = sendSlackNotification(user, org);
  const hubSpotPromise = createLeadInHubSpot(user, org);

  try {
    await Promise.all([slackNotificationPromise, hubSpotPromise]);
  } catch (err) {
    Sentry.captureException(err);
  }
};

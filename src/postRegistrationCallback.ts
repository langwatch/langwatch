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

const submitLeadFormInHubSpot = async (user: any, org: any) => {
  const currentTimestamp = new Date().getTime();
  const formData = {
    submittedAt: currentTimestamp,
    fields: [
      {
        objectTypeId: "0-1",
        name: "company",
        value: org.orgName,
      },
      {
        objectTypeId: "0-1",
        name: "firstname",
        value: user.name,
      },
      {
        objectTypeId: "0-1",
        name: "email",
        value: user.email,
      },
      {
        objectTypeId: "0-1",
        name: "mobilephone",
        value: org.phoneNumber,
      },
    ],
    context: {
      pageUri: "app.langwatch.ai",
      pageName: "Sign Up",
    },
  };

  const hubspotPortalId = process.env.HUBSPOT_PORTAL_ID!;
  const hubspotFormId = process.env.HUBSPOT_FORM_ID!;

  const url = `https://api.hsforms.com/submissions/v3/integration/submit/${hubspotPortalId}/${hubspotFormId}`;
  const headers = {
    "Content-Type": "application/json",
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      Sentry.captureException(response);
    }
  } catch (error) {
    Sentry.captureException(error);
  }
};

export const PostRegistrationCallback = async (user: any, org: any) => {
  const slackNotificationPromise = sendSlackNotification(user, org);

  // Keeping this, as we might want to use it again.
  //const hubSpotPromise = createLeadInHubSpot(user, org);
  //const hubSpotFormPromise = submitLeadFormInHubSpot(user, org);

  try {
    await Promise.all([slackNotificationPromise]);
  } catch (err) {
    Sentry.captureException(err);
  }
};

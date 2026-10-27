import type {
  PlanLimitNotificationContext,
  SignupNotificationPayload,
} from "@langwatch/enterprise-billing-contract";

export type HubspotFormBody = {
  fields: { objectTypeId: string; name: string; value: string | undefined }[];
  context: { pageUri: string; pageName: string };
};

const HUBSPOT_FIELD_OBJECT_TYPE = "0-1";

export function signupFormBody(payload: SignupNotificationPayload): HubspotFormBody {
  const nameParts = (payload.userName ?? "").split(" ").filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1]! : "";
  const signUpData = payload.signUpData;

  return {
    fields: [
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "company",
        value: payload.organizationName ?? "",
      },
      { objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE, name: "firstname", value: firstName },
      { objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE, name: "lastname", value: lastName },
      { objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE, name: "email", value: payload.userEmail ?? "" },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "mobilephone",
        value: payload.phoneNumber ?? "",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "Features_usage_multiple",
        value: signUpData?.featureUsage ?? "Other",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "user_role",
        value: signUpData?.yourRole ?? "Other",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "product_usage",
        value: signUpData?.usage ?? "",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "product_solution",
        value: signUpData?.solution ?? "",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "organization_size",
        value: signUpData?.companySize ?? "1",
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "utm_campaign",
        value: signUpData?.utmCampaign ?? payload.utmCampaign ?? "",
      },
    ],
    context: {
      pageUri: "app.langwatch.ai",
      pageName: "Sign Up",
    },
  };
}

export function planLimitFormBody(context: PlanLimitNotificationContext): HubspotFormBody {
  return {
    fields: [
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "firstname",
        value: context.adminName,
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "company",
        value: context.organizationName,
      },
      {
        objectTypeId: HUBSPOT_FIELD_OBJECT_TYPE,
        name: "email",
        value: context.adminEmail,
      },
    ],
    context: {
      pageUri: "app.langwatch.ai",
      pageName: "Plan Limit Reached",
    },
  };
}

export function hubspotFormUrl({ portalId, formId }: { portalId: string; formId: string }): string {
  return `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formId}`;
}

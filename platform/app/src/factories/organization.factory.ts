import { DEFAULT_DOMAIN_JOIN_SETTING } from "@langwatch/identity";
import { Factory } from "fishery";
import { nanoid } from "nanoid";
import { type Organization, PricingModel } from "~/generated/prisma/client";

export const organizationFactory = Factory.define<
  Omit<Organization, "stripeCustomerId" | "currency" | "signupData">
>(({ sequence }) => ({
  id: nanoid(),
  name: `Test Organization ${sequence}`,
  phoneNumber: null,
  slug: `test-org-${sequence}-${nanoid()}`,
  createdAt: new Date(),
  updatedAt: new Date(),
  usageSpendingMaxLimit: null,
  maxSessionDurationDays: 0,
  mfaRequired: false,
  signedDPA: false,
  elasticsearchNodeUrl: null,
  elasticsearchApiKey: null,
  useCustomElasticsearch: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  useCustomS3: false,
  sentPlanLimitAlert: null,
  pricingModel: PricingModel.SEAT_EVENT,
  promoCode: null,
  ssoDomain: null,
  ssoProvider: null,
  domainJoin: DEFAULT_DOMAIN_JOIN_SETTING,
  joinDomains: [],
  license: null,
  licenseExpiresAt: null,
  licenseLastValidatedAt: null,
  presenceEnabled: false,
  traceSharingEnabled: true,
  supportContact: null,
  primaryIntent: null,
}));

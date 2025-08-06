import { type Organization } from "@prisma/client";
import { Factory } from "fishery";
import { nanoid } from "nanoid";

export const organizationFactory = Factory.define<
  Organization & {
    signupData: any;
  }
>(({ sequence }) => ({
  id: nanoid(),
  name: `Test Organization ${sequence}`,
  phoneNumber: null,
  slug: `test-org-${sequence}-${nanoid()}`,
  createdAt: new Date(),
  updatedAt: new Date(),
  usageSpendingMaxLimit: null,
  signupData: null,
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
  promoCode: null,
}));

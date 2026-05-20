import {
  Prisma,
  PIIRedactionLevel,
  type Project,
  ProjectSensitiveDataVisibilityLevel,
} from "@prisma/client";
import { Factory } from "fishery";
import { nanoid } from "nanoid";

export type ProjectFactoryOutput = Omit<Project, "retentionPolicy"> & {
  retentionPolicy: null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const projectFactory = Factory.define<any>(({ sequence }) => ({
  id: nanoid(),
  name: `Test Project ${sequence}`,
  slug: `test-project-${sequence}`,
  apiKey: `test-api-key-${nanoid()}`,
  teamId: nanoid(),
  language: "en",
  framework: "langchain",
  kind: "application",
  firstMessage: false,
  integrated: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  userLinkTemplate: null,
  piiRedactionLevel: PIIRedactionLevel.ESSENTIAL,
  capturedInputVisibility: ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
  capturedOutputVisibility: ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
  traceSharingEnabled: true,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  presenceEnabled: false,
  personalFeatures: {},
  costCenterId: null,
  retentionPolicy: null,
}));

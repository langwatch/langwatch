import { Factory } from "fishery";
import { type Project, PIIRedactionLevel, ProjectSensitiveDataVisibilityLevel } from "@prisma/client";
import { nanoid } from "nanoid";

export const projectFactory = Factory.define<Project>(({ sequence }) => ({
  id: nanoid(),
  name: `Test Project ${sequence}`,
  slug: `test-project-${sequence}`,
  apiKey: `test-api-key-${nanoid()}`,
  teamId: nanoid(),
  language: "en",
  framework: "langchain",
  firstMessage: false,
  integrated: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  userLinkTemplate: null,
  piiRedactionLevel: PIIRedactionLevel.ESSENTIAL,
  capturedInputVisibility: ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
  capturedOutputVisibility: ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
  defaultModel: null,
  topicClusteringModel: null,
  embeddingsModel: null,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
}));

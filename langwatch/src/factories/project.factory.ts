import {
  PIIRedactionLevel,
  type Project,
  ProjectSensitiveDataVisibilityLevel,
} from "@prisma/client";
import { Factory } from "fishery";
import { nanoid } from "nanoid";

// Omit Json? fields — Prisma's output type (JsonValue | null) is structurally
// incompatible with its input type (InputJsonValue | NullableJsonNullValueInput).
// Excluding them lets the factory output be spread directly into prisma.*.create()
// while Prisma applies the column default (NULL).
export const projectFactory = Factory.define<
  Omit<Project, "retentionPolicy" | "personalFeatures">
>(({ sequence }) => ({
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
  costCenterId: null,
}));

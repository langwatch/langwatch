import type { Project } from "@prisma/client";
import { Factory } from "fishery";
import { nanoid } from "nanoid";

// Omit the Json fields - Prisma's output type (JsonValue | null) is structurally
// incompatible with its input type (InputJsonValue | NullableJsonNullValueInput).
// Excluding them lets the factory output be spread directly into prisma.*.create()
// while Prisma applies the column default (NULL). Every nullable Json column on
// Project (personalFeatures, langyEgressAllowlist) must be listed here.
export const projectFactory = Factory.define<
  Omit<Project, "personalFeatures" | "langyEgressAllowlist">
>(
  ({ sequence }) => ({
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
    traceSharingEnabled: true,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    presenceEnabled: false,
    departmentId: null,
  }),
);

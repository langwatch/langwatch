import { Factory } from "fishery";
import { nanoid } from "nanoid";
import type { Project } from "~/generated/prisma/client";

// Omit the Json fields - Prisma's output type (JsonValue | null) is structurally
// incompatible with its input type (InputJsonValue | NullableJsonNullValueInput).
// Excluding them lets the factory output be spread directly into prisma.*.create()
// while Prisma applies the column default (NULL). Every nullable Json column on
// Project (personalFeatures, langyEgressAllowlist) must be listed here.
//
// The project API key is written the way rows stored before keys were hashed
// hold it: plaintext only. That still authenticates (`findProjectByApiKey`
// finds it by plaintext and hashes it on first use), so a test can send
// `project.apiKey` as its credential. A test about hashed storage mints its
// own key with `mintProjectApiKey()` and spreads its columns over these.
export const projectFactory = Factory.define<
  Omit<Project, "personalFeatures" | "langyEgressAllowlist"> & {
    apiKey: string;
  }
>(({ sequence }) => ({
  id: nanoid(),
  name: `Test Project ${sequence}`,
  slug: `test-project-${sequence}`,
  apiKey: `test-api-key-${nanoid()}`,
  apiKeyHash: null,
  apiKeyLast4: null,
  apiKeyHashedAt: null,
  lwqlKey: `test-lwql-key-${nanoid()}`,
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
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
}));

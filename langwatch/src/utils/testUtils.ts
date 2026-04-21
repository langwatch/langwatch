import {
  OrganizationUserRole,
  PIIRedactionLevel,
  type Project,
  ProjectSensitiveDataVisibilityLevel,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import { createMocks, type RequestMethod } from "node-mocks-http";
import { prisma } from "../server/db";
import { ENTERPRISE_LICENSE_KEY } from "../../ee/licensing/__tests__/fixtures/testLicenses";

export async function getTestUser() {
  // Upsert everything: concurrent test files in the same shard race on findUnique + create.
  const user = await prisma.user.upsert({
    where: { email: "test-user@example.com" },
    update: {},
    create: {
      name: "Test User",
      email: "test-user@example.com",
    },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: "test-organization" },
    update: { license: ENTERPRISE_LICENSE_KEY },
    create: {
      name: "Test Organization",
      slug: "test-organization",
      license: ENTERPRISE_LICENSE_KEY,
    },
  });

  const team = await prisma.team.upsert({
    where: { slug: "test-team", organizationId: organization.id },
    update: {},
    create: {
      name: "Test Team",
      slug: "test-team",
      organizationId: organization.id,
    },
  });

  await prisma.project.upsert({
    where: { id: "test-project-id" },
    update: {},
    create: {
      id: "test-project-id",
      name: "Test Project",
      slug: "test-project",
      apiKey: "test-api-key",
      teamId: team.id,
      language: "en",
      framework: "test-framework",
    },
  });

  await prisma.teamUser.upsert({
    where: { userId_teamId: { userId: user.id, teamId: team.id } },
    update: {},
    create: {
      userId: user.id,
      teamId: team.id,
      role: TeamUserRole.MEMBER,
    },
  });

  await prisma.organizationUser.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: organization.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      organizationId: organization.id,
      role: OrganizationUserRole.MEMBER,
    },
  });

  return user;
}

export async function getTestProject(namespace: string): Promise<Project> {
  let organization = await prisma.organization.findUnique({
    where: { slug: `--test-organization-${namespace}` },
  });
  if (!organization) {
    organization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `--test-organization-${namespace}`,
      },
    });
  }

  let team = await prisma.team.findUnique({
    where: {
      slug: `--test-team-${namespace}`,
      organizationId: organization.id,
    },
  });
  if (!team) {
    team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `--test-team-${namespace}`,
        organizationId: organization.id,
      },
    });
  }

  let project = await prisma.project.findUnique({
    where: { slug: `--test-project-${namespace}`, teamId: team.id },
  });
  if (!project) {
    project = await prisma.project.create({
      data: {
        name: "Test Project",
        slug: `--test-project-${namespace}`,
        language: "python",
        framework: "openai",
        apiKey: `test-auth-token-${nanoid()}`,
        teamId: team.id,
        piiRedactionLevel: PIIRedactionLevel.ESSENTIAL,
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
      },
    });
  }

  return project;
}

export const waitForResult = async <T>(
  queryFn: () => Promise<T | null>,
  maxRetries = 10,
  retryDelay = 1000,
): Promise<T> => {
  let lastError: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await queryFn();
      if (result !== null) return result;
    } catch (e) {
      lastError = e as Error;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }
  throw new Error(
    `Result not found after multiple retries. Last error: ${lastError?.message}`,
  );
};

/**
 * Creates a mock request and response for a Next.js API route.
 * @param param0 - The request method, headers, and body.
 * @returns A mock request and response.
 */
export const createNextApiMocks = ({
  method,
  headers,
  body,
}: {
  method: RequestMethod;
  headers?: Record<string, string | undefined>;
  body?: any;
}) => {
  const { req, res } = createMocks({
    method,
    headers,
    body,
  });

  return { req, res } as unknown as {
    req: NextApiRequest;
    res: NextApiResponse;
  };
};

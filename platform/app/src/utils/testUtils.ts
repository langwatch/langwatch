import {
  type Organization,
  OrganizationUserRole,
  Prisma,
  type Project,
  type Team,
  TeamUserRole,
  type User,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { createMocks, type RequestMethod } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import { ENTERPRISE_LICENSE_KEY } from "../../ee/licensing/__tests__/fixtures/testLicenses";
import { prisma } from "../server/db";

async function ignoreUniqueViolation<T>(
  promise: Promise<T>,
): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return null;
    }
    throw error;
  }
}

async function readAfterUniqueViolation<T>(
  promise: Promise<T>,
  readExisting: () => Promise<T | null>,
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await readExisting();
      if (existing) {
        return existing;
      }
    }
    throw error;
  }
}

function upsertSharedTestUser(): Promise<User> {
  return readAfterUniqueViolation<User>(
    prisma.user.upsert({
      where: { email: "test-user@example.com" },
      update: {},
      create: {
        name: "Test User",
        email: "test-user@example.com",
      },
    }),
    () => prisma.user.findUnique({ where: { email: "test-user@example.com" } }),
  );
}

function upsertSharedTestOrganization(): Promise<Organization> {
  return readAfterUniqueViolation<Organization>(
    prisma.organization.upsert({
      where: { slug: "test-organization" },
      update: { license: ENTERPRISE_LICENSE_KEY },
      create: {
        name: "Test Organization",
        slug: "test-organization",
        license: ENTERPRISE_LICENSE_KEY,
      },
    }),
    () =>
      prisma.organization.findUnique({ where: { slug: "test-organization" } }),
  );
}

function upsertSharedTestTeam({
  organizationId,
}: {
  organizationId: string;
}): Promise<Team> {
  return readAfterUniqueViolation<Team>(
    prisma.team.upsert({
      where: { slug: "test-team", organizationId },
      update: {},
      create: {
        name: "Test Team",
        slug: "test-team",
        organizationId,
      },
    }),
    () =>
      prisma.team.findUnique({
        where: { slug: "test-team", organizationId },
      }),
  );
}

function upsertSharedTestProject({
  teamId,
}: {
  teamId: string;
}): Promise<Project> {
  return readAfterUniqueViolation<Project>(
    prisma.project.upsert({
      where: { id: "test-project-id" },
      update: {},
      create: {
        id: "test-project-id",
        name: "Test Project",
        slug: "test-project",
        apiKey: "test-api-key",
        teamId,
        language: "en",
        framework: "test-framework",
      },
    }),
    () => prisma.project.findUnique({ where: { id: "test-project-id" } }),
  );
}

function joinTestTeam({ userId, teamId }: { userId: string; teamId: string }) {
  return ignoreUniqueViolation(
    prisma.teamUser.create({
      data: {
        userId,
        teamId,
        role: TeamUserRole.MEMBER,
      },
    }),
  );
}

function joinTestOrganization({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  return ignoreUniqueViolation(
    prisma.organizationUser.create({
      data: {
        userId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    }),
  );
}

export async function getTestUser() {
  const user = await upsertSharedTestUser();
  const organization = await upsertSharedTestOrganization();
  const team = await upsertSharedTestTeam({
    organizationId: organization.id,
  });

  await upsertSharedTestProject({ teamId: team.id });
  await joinTestTeam({ userId: user.id, teamId: team.id });
  await joinTestOrganization({
    userId: user.id,
    organizationId: organization.id,
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

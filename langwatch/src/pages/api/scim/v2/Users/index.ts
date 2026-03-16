import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "~/server/db";
import { getScimOrganization, ScimAuthError } from "~/server/scim/scim-auth";
import {
  toScimUser,
  scimError,
  scimListResponse,
} from "~/server/scim/scim-user-mapper";
import { UserService } from "~/server/users/user.service";

/**
 * SCIM 2.0 /Users endpoint.
 * GET  - List/filter users in the organization.
 * POST - Provision a new user.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Content-Type", "application/scim+json");

  let organizationId: string;
  try {
    organizationId = await getScimOrganization({ req });
  } catch (error) {
    if (error instanceof ScimAuthError) {
      return res.status(401).json(scimError({ status: 401, detail: error.message }));
    }
    return res.status(500).json(scimError({ status: 500, detail: "Internal server error" }));
  }

  if (req.method === "GET") {
    return handleGet({ req, res, organizationId });
  }

  if (req.method === "POST") {
    return handlePost({ req, res, organizationId });
  }

  return res.status(405).json(scimError({ status: 405, detail: "Method not allowed" }));
}

async function handleGet({
  req,
  res,
  organizationId,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
  organizationId: string;
}) {
  const filter = req.query.filter as string | undefined;
  const startIndex = Math.max(1, parseInt(req.query.startIndex as string) || 1);
  const count = Math.min(200, Math.max(1, parseInt(req.query.count as string) || 100));

  let emailFilter: string | undefined;
  if (filter) {
    const match = filter.match(/userName\s+eq\s+"([^"]+)"/);
    if (match?.[1]) {
      emailFilter = match[1];
    }
  }

  const where = {
    orgMemberships: {
      some: { organizationId },
    },
    ...(emailFilter && { email: emailFilter }),
  };

  const [totalResults, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: startIndex - 1,
      take: count,
      orderBy: { createdAt: "asc" as const },
    }),
  ]);

  const resources = users.map((user) => toScimUser({ user }));

  return res.status(200).json(
    scimListResponse({
      resources,
      totalResults,
      startIndex,
      itemsPerPage: resources.length,
    }),
  );
}

async function handlePost({
  req,
  res,
  organizationId,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
  organizationId: string;
}) {
  const body = req.body;
  const email = body.userName;
  const givenName = body.name?.givenName ?? "";
  const familyName = body.name?.familyName ?? "";
  const name = [givenName, familyName].filter(Boolean).join(" ");
  const externalId = body.externalId;
  const active = body.active !== false;

  if (!email) {
    return res.status(400).json(scimError({ status: 400, detail: "userName (email) is required" }));
  }

  const userService = UserService.create(prisma);

  // Check if user already exists in this org
  const existingUser = await userService.findByEmail({ email });
  if (existingUser) {
    const existingMembership = await prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId: existingUser.id,
          organizationId,
        },
      },
    });
    if (existingMembership) {
      return res.status(409).json(
        scimError({ status: 409, detail: `User with email "${email}" already exists in this organization` }),
      );
    }
  }

  // Create user or reuse existing
  let user;
  if (existingUser) {
    // User exists but not in this org - this is a conflict per spec
    return res.status(409).json(
      scimError({ status: 409, detail: `User with email "${email}" already exists` }),
    );
  }

  user = await userService.create({ name, email, externalId });

  // Add user to org as MEMBER
  await prisma.organizationUser.create({
    data: {
      userId: user.id,
      organizationId,
      role: "MEMBER",
    },
  });

  // Handle active=false (provision as deactivated)
  if (!active) {
    user = await userService.deactivate({ id: user.id });
  }

  return res.status(201).json(toScimUser({ user }));
}

import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "~/server/db";
import { getScimOrganization, ScimAuthError } from "~/server/scim/scim-auth";
import { toScimUser, scimError } from "~/server/scim/scim-user-mapper";
import { UserService } from "~/server/users/user.service";

/**
 * SCIM 2.0 /Users/:id endpoint.
 * GET    - Retrieve a single user.
 * PUT    - Full replacement update.
 * PATCH  - Partial update (SCIM PatchOp).
 * DELETE - Deprovision user.
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

  const userId = req.query.id as string;
  if (!userId) {
    return res.status(400).json(scimError({ status: 400, detail: "User ID is required" }));
  }

  const userService = UserService.create(prisma);

  // Verify user exists and belongs to this org
  const user = await findOrgUser({ userId, organizationId });
  if (!user && req.method !== "DELETE") {
    return res.status(404).json(scimError({ status: 404, detail: "User not found" }));
  }

  switch (req.method) {
    case "GET":
      return res.status(200).json(toScimUser({ user: user! }));

    case "PUT":
      return handlePut({ req, res, userId, userService });

    case "PATCH":
      return handlePatch({ req, res, userId, userService });

    case "DELETE":
      return handleDelete({ res, userId, organizationId, userService, userExists: !!user });

    default:
      return res.status(405).json(scimError({ status: 405, detail: "Method not allowed" }));
  }
}

async function findOrgUser({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  return prisma.user.findFirst({
    where: {
      id: userId,
      orgMemberships: {
        some: { organizationId },
      },
    },
  });
}

async function handlePut({
  req,
  res,
  userId,
  userService,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
  userId: string;
  userService: UserService;
}) {
  const body = req.body;
  const givenName = body.name?.givenName;
  const familyName = body.name?.familyName;

  // Build name from given/family
  const currentUser = await userService.findById({ id: userId });
  if (!currentUser) {
    return res.status(404).json(scimError({ status: 404, detail: "User not found" }));
  }

  const currentParts = (currentUser.name ?? "").split(" ");
  const newGivenName = givenName ?? currentParts[0] ?? "";
  const newFamilyName = familyName ?? currentParts.slice(1).join(" ") ?? "";
  const name = [newGivenName, newFamilyName].filter(Boolean).join(" ");

  let updatedUser = await userService.updateProfile({
    id: userId,
    name,
    ...(body.userName && { email: body.userName }),
  });

  // Handle active field
  if (body.active === false && updatedUser.deactivatedAt === null) {
    updatedUser = await userService.deactivate({ id: userId });
  } else if (body.active === true && updatedUser.deactivatedAt !== null) {
    updatedUser = await userService.reactivate({ id: userId });
  }

  // Handle externalId
  if (body.externalId) {
    updatedUser = await userService.setExternalId({ id: userId, externalId: body.externalId });
  }

  return res.status(200).json(toScimUser({ user: updatedUser }));
}

async function handlePatch({
  req,
  res,
  userId,
  userService,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
  userId: string;
  userService: UserService;
}) {
  const operations = req.body.Operations ?? req.body.operations ?? [];

  const currentUser = await userService.findById({ id: userId });
  if (!currentUser) {
    return res.status(404).json(scimError({ status: 404, detail: "User not found" }));
  }

  const currentParts = (currentUser.name ?? "").split(" ");
  let givenName = currentParts[0] ?? "";
  let familyName = currentParts.slice(1).join(" ") || "";
  let nameChanged = false;
  let activeChange: boolean | undefined;
  let emailChange: string | undefined;

  for (const op of operations) {
    const operation = (op.op ?? "").toLowerCase();
    const path = op.path ?? "";
    const value = op.value;

    if (path === "name.givenName" && (operation === "replace" || operation === "add")) {
      givenName = value;
      nameChanged = true;
    } else if (path === "name.familyName" && (operation === "replace" || operation === "add")) {
      familyName = value;
      nameChanged = true;
    } else if ((path === "displayName" || path === "name.formatted") && (operation === "replace" || operation === "add")) {
      const parts = (value ?? "").split(" ");
      givenName = parts[0] ?? "";
      familyName = parts.slice(1).join(" ") || "";
      nameChanged = true;
    } else if (path === "active" && (operation === "replace" || operation === "add")) {
      activeChange = value === true || value === "true";
    } else if (path === "userName" && (operation === "replace" || operation === "add")) {
      emailChange = value;
    } else if (path === "" && typeof value === "object" && value !== null) {
      // Handle valueless path where value is an object with multiple attrs
      if ("active" in value) {
        activeChange = value.active === true || value.active === "true";
      }
      if (value.name?.givenName) {
        givenName = value.name.givenName;
        nameChanged = true;
      }
      if (value.name?.familyName) {
        familyName = value.name.familyName;
        nameChanged = true;
      }
    }
  }

  let updatedUser = currentUser;

  if (nameChanged || emailChange) {
    const name = nameChanged
      ? [givenName, familyName].filter(Boolean).join(" ")
      : undefined;
    updatedUser = await userService.updateProfile({
      id: userId,
      name,
      email: emailChange,
    });
  }

  if (activeChange === false && updatedUser.deactivatedAt === null) {
    updatedUser = await userService.deactivate({ id: userId });
  } else if (activeChange === true && updatedUser.deactivatedAt !== null) {
    updatedUser = await userService.reactivate({ id: userId });
  }

  return res.status(200).json(toScimUser({ user: updatedUser }));
}

async function handleDelete({
  res,
  userId,
  organizationId,
  userService,
  userExists,
}: {
  res: NextApiResponse;
  userId: string;
  organizationId: string;
  userService: UserService;
  userExists: boolean;
}) {
  if (!userExists) {
    return res.status(404).json(scimError({ status: 404, detail: "User not found" }));
  }

  // Deactivate user
  await userService.deactivate({ id: userId });

  // Remove from organization
  await prisma.organizationUser.delete({
    where: {
      userId_organizationId: {
        userId,
        organizationId,
      },
    },
  });

  return res.status(204).end();
}

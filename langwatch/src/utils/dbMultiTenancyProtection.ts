import { type Prisma } from "@prisma/client";

const EXEMPT_MODELS = [
  "Account",
  "Session",
  "User",
  "VerificationToken",
  "TeamUser",
  "OrganizationUser",
  "Team",
  "Organization",
  "OrganizationInvite",
  "Project",
  "Subscription",
  "OrganizationFeature",
  "AuditLog",
];

const _guardProjectId = ({ params }: { params: Prisma.MiddlewareParams }) => {
  if (params.model && EXEMPT_MODELS.includes(params.model)) return;

  const action = params.action;
  const model = params.model;

  if (
    (action === "findFirst" || action === "findUnique") &&
    model === "PublicShare" &&
    (params.args?.where?.id ||
      (params.args?.where?.resourceType && params.args?.where?.resourceId))
  ) {
    return;
  }

  if (action === "create" || action === "createMany") {
    const data =
      action === "create"
        ? params.args?.data
        : params.args?.data?.map((d: any) => d);
    const hasProjectId = Array.isArray(data)
      ? data.every((d) => d.projectId)
      : data?.projectId;

    if (!hasProjectId) {
      throw new Error(
        `The ${action} action on the ${model} model requires a 'projectId' in the data field`
      );
    }
  } else if (
    !params.args?.where?.projectId &&
    !params.args?.where?.projectId_slug &&
    !params.args?.where?.projectId?.in &&
    !params.args?.where?.OR?.every((o: any) => o.projectId || o.organizationId)
  ) {
    throw new Error(
      params.args?.where?.OR
        ? `The ${action} action on the ${model} model requires that all the OR clauses check for either the projectId or organizationId`
        : `The ${action} action on the ${model} model requires a 'projectId' or 'projectId.in' in the where clause`
    );
  }
};

export const guardProjectId: Prisma.Middleware = async (params, next) => {
  _guardProjectId({ params });
  return next(params);
};

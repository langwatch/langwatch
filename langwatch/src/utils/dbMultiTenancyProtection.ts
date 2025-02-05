import { type Prisma } from "@prisma/client";
import { isGuardedString } from "../server/api/permission";

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
  const action = params.action;
  const model = params.model;
  const data =
    action === "create"
      ? params.args?.data
      : action === "createMany"
      ? params.args?.data?.map((d: any) => d)
      : undefined;

  Array.isArray(data)
    ? data.forEach((d) => unwrapGuardedValues(model, action, d))
    : unwrapGuardedValues(model, action, data);
  unwrapGuardedValues(model, action, params.args?.where);

  if (params.model && EXEMPT_MODELS.includes(params.model)) return;

  if (
    (action === "findFirst" || action === "findUnique") &&
    model === "PublicShare" &&
    (params.args?.where?.id ||
      (params.args?.where?.resourceType && params.args?.where?.resourceId))
  ) {
    return;
  }

  if (action === "create" || action === "createMany") {
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
    !params.args?.where?.projectId_slug
  ) {
    throw new Error(
      `The ${action} action on the ${model} model requires a 'projectId' in the where clause`
    );
  }
};

const unwrapGuardedValues = (
  model: string | undefined,
  action: string,
  params: Record<string, any> | undefined
) => {
  const SENSITIVE_KEYS = ["projectId", "teamId", "organizationId"];

  Object.entries(params || {}).forEach(([key, value]) => {
    if (SENSITIVE_KEYS.includes(key) && value && !isGuardedString(value)) {
      throw new Error(
        `${key} being used for ${model} ${action} must be a permissionGuardedString`
      );
    }
    if (isGuardedString(value)) {
      if (value.isValidated) {
        params![key] = value.value;
      } else {
        throw new Error(
          `${key} being used for ${model} ${action} is not validated, please use the checkUserPermission middlewares to validate it on the trpc endpoint`
        );
      }
    }
  });
};

export const guardProjectId: Prisma.Middleware = async (params, next) => {
  _guardProjectId({ params });
  return next(params);
};

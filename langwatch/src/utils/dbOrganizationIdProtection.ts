import { type Prisma } from "@prisma/client";

const PROTECTED_MODELS = ["OrganizationUser", "Team", "OrganizationInvite"];

const _guardOrganizationId = ({
  params,
}: {
  params: Prisma.MiddlewareParams;
}) => {
  if (!params.model || !PROTECTED_MODELS.includes(params.model)) return;

  const action = params.action;
  const model = params.model;

  if (action === "create" || action === "createMany") {
    const data =
      action === "create"
        ? params.args?.data
        : params.args?.data?.map((d: any) => d);
    const hasOrganizationId = Array.isArray(data)
      ? data.every((d) => d.organizationId)
      : data?.organizationId;

    if (!hasOrganizationId) {
      throw new Error(
        `The ${action} action on the ${model} model requires a 'organizationId' in the data field`
      );
    }
  } else if (
    !params.args?.where?.organizationId &&
    !params.args?.where?.inviteCode &&
    !params.args?.where?.userId_organizationId &&
    !(params.model === "Team" && params.args?.where?.id)
  ) {
    throw new Error(
      `The ${action} action on the ${model} model requires a 'organizationId' in the where clause`
    );
  }
};

export const guardOrganizationId: Prisma.Middleware = async (params, next) => {
  _guardOrganizationId({ params });
  return next(params);
};

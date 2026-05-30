import { NotFoundError } from "~/server/app-layer/domain-error";

export class SsoConnectionNotFoundError extends NotFoundError {
  declare readonly kind: "sso_connection_not_found";

  constructor(id: string, options: { reasons?: readonly Error[] } = {}) {
    super("sso_connection_not_found", "SSO connection", id, {
      meta: { id },
      ...options,
    });
    this.name = "SsoConnectionNotFoundError";
  }
}

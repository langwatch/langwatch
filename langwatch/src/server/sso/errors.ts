import { NotFoundError } from "~/server/app-layer/domain-error";

export class SsoProviderNotFoundError extends NotFoundError {
  declare readonly kind: "sso_provider_not_found";

  constructor(id: string, options: { reasons?: readonly Error[] } = {}) {
    super("sso_provider_not_found", "SSO provider", id, {
      meta: { id },
      ...options,
    });
    this.name = "SsoProviderNotFoundError";
  }
}

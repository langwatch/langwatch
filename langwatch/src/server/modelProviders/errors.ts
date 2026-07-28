import { HandledError } from "@langwatch/handled-error";

/**
 * The model provider a read or write named does not exist, or is not visible
 * to the caller's scopes.
 *
 * Deliberately one error for both: telling a caller that a row exists but is
 * out of their scope is a membership oracle, and there is nothing they could
 * do with the answer either way. The remedy is the same — reload and pick from
 * what is actually there.
 *
 * A handled error rather than the `TRPCError({ code: "NOT_FOUND" })` this
 * replaced at five call sites: the cause is known and the caller can act on
 * it, which is the whole test (ADR-045). It also stops the service layer from
 * reaching for a transport's error type to say a domain thing.
 */
export class ModelProviderNotFoundError extends HandledError {
  declare readonly code: "model_provider_not_found";

  constructor() {
    super("model_provider_not_found", "Model provider not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "ModelProviderNotFoundError";
  }
}

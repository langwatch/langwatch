import { generate } from "@langwatch/ksuid";
import { ApiKeyBindingId } from "../app/api-key.app.ts";

/**
 * The AuthZ binding identifier an API-key grant is written under.
 *
 * It is a KSUID with the same `rolebinding` resource every other binding in
 * the product carries, so a binding minted for a key is indistinguishable from
 * one minted for a member. That prefix is a persisted format: a process that
 * spelled it differently would write bindings the revocation queries do not
 * find.
 */
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

export class ApiKeyBindingIdAdapter implements ApiKeyBindingId {
  static create(): ApiKeyBindingIdAdapter {
    return new ApiKeyBindingIdAdapter();
  }

  private constructor() {
  }

  generateBindingId(): string {
    return generate(ROLE_BINDING_KSUID_RESOURCE).toString();
  }
}

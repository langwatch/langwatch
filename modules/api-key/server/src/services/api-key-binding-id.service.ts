import { generate } from "@langwatch/ksuid";

/**
 * Generates opaque AuthZ binding identifiers for API-key grants. Declared
 * beside the one thing that answers it: an application is not the home of a
 * service's own seam, and stating it there made the app and its services
 * import each other.
 */
export interface ApiKeyBindingId {
  generateBindingId(): string;
}

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

import { generate } from "@langwatch/ksuid";

/**
 * Generates opaque AuthZ binding identifiers for API-key grants. Declared
 * beside the one thing that answers it — an application is not the home
 * of a service's own seam; stating it there made app and service import each other.
 */
export interface ApiKeyBindingId {
  generateBindingId(): string;
}

// AuthZ binding ID: KSUID with rolebinding resource (persisted format—revocation queries depend on
// it).
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

export class ApiKeyBindingIdAdapter implements ApiKeyBindingId {
  static create(): ApiKeyBindingIdAdapter {
    return new ApiKeyBindingIdAdapter();
  }

  private constructor() {}

  generateBindingId(): string {
    return generate(ROLE_BINDING_KSUID_RESOURCE).toString();
  }
}

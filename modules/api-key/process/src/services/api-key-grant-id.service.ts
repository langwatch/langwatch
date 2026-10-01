import { generate } from "@langwatch/ksuid";

/**
 * Generates opaque AuthZ binding identifiers for API-key grants. Declared
 * beside the one thing that answers it — an application is not the home
 * of a service's own seam; stating it there made app and service import each other.
 */
export interface ApiKeyGrantId {
  generateBindingId(): string;
}

// AuthZ binding ID: KSUID with rolebinding resource (persisted format—revocation queries depend on
// it).
const GRANT_KSUID_RESOURCE = "rolebinding";

export class ApiKeyGrantIdService implements ApiKeyGrantId {
  static create(): ApiKeyGrantIdService {
    return new ApiKeyGrantIdService();
  }

  private constructor() {}

  generateBindingId(): string {
    return generate(GRANT_KSUID_RESOURCE).toString();
  }
}

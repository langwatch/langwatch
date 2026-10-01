import { generate } from "@langwatch/ksuid";

// Grant id is caller-minted KSUID; persisted format shared across processes.
const GRANT_KSUID_RESOURCE = "rolebinding";

export class AuthzGrantIdService {
  static create(): AuthzGrantIdService {
    return new AuthzGrantIdService();
  }

  private constructor() {}

  newBindingId(): string {
    return generate(GRANT_KSUID_RESOURCE).toString();
  }
}

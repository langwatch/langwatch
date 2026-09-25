import { generate } from "@langwatch/ksuid";

// Grant id is caller-minted KSUID; persisted format shared across processes.
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

export class AuthzBindingIdService {
  static create(): AuthzBindingIdService {
    return new AuthzBindingIdService();
  }

  private constructor() {}

  newBindingId(): string {
    return generate(ROLE_BINDING_KSUID_RESOURCE).toString();
  }
}

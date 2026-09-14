import { generate } from "@langwatch/ksuid";

// Grant id is caller-minted KSUID; persisted format shared across processes.
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

export class KsuidAuthzBindingIdAdapter {
  static create(): KsuidAuthzBindingIdAdapter {
    return new KsuidAuthzBindingIdAdapter();
  }

  private constructor() {}

  newBindingId(): string {
    return generate(ROLE_BINDING_KSUID_RESOURCE).toString();
  }
}

import { generate } from "@langwatch/ksuid";

/**
 * The identifier a newly minted grant is written under.
 *
 * A runtime fact's grant id IS the binding KSUID the caller minted — the same
 * id the REST surface returns to a customer — so this prefix is a persisted
 * format rather than a local convention: a composition root that spelled it
 * differently would write bindings the revocation and listing queries never
 * find. It lives here, beside the service that mints with it, so a second
 * process composing AuthZ inherits the format instead of restating it.
 */
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

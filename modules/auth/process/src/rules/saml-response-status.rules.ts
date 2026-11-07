/**
 * What a SAML Response posted to the assertion consumer says, read before Better Auth answers it
 * (specs/identity/idp-refused-sign-in.feature). A refusal has no assertion and is usually unsigned:
 * its status is only the presenter's own claim, as OIDC's `access_denied` is.
 */

const SAML_ACS_PATH = /^\/api\/auth\/sso\/saml2\/sp\/acs\/[^/]+$/;
/** A posted response past this size is not read for its status. */
const MAX_FORM_BODY_BYTES = 512 * 1024;
const SUCCESS_STATUS = "urn:oasis:names:tc:SAML:2.0:status:Success";
/** The first `StatusCode` in a Response is its top-level one (SAML Core 3.2.2.2). */
const TOP_LEVEL_STATUS_CODE = /<(?:[\w.-]+:)?StatusCode\b[^>]*?\bValue\s*=\s*["']([^"']+)["']/;

/** Whether this request is a SAML Response posted back to one connection's assertion consumer. */
export function isSamlAssertionConsumerPost({
  pathname,
  method,
}: {
  pathname: string;
  method: string;
}): boolean {
  return method === "POST" && SAML_ACS_PATH.test(pathname);
}

/** `refused` when the posted Response names a status other than Success; `other` otherwise. */
export function samlResponseOutcomeOf({ formBody }: { formBody: string }): "refused" | "other" {
  if (formBody.length > MAX_FORM_BODY_BYTES) return "other";
  const encoded = new URLSearchParams(formBody).get("SAMLResponse");
  if (!encoded) return "other";
  let xml: string;
  try {
    xml = Buffer.from(encoded.replace(/\s+/g, ""), "base64").toString("utf8");
  } catch {
    return "other";
  }
  const status = TOP_LEVEL_STATUS_CODE.exec(xml)?.[1]?.trim();
  if (!status) return "other";
  return status === SUCCESS_STATUS ? "other" : "refused";
}

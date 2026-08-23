import { MASKED_KEY_PLACEHOLDER } from "../../utils/constants";
import { isSecretCredentialField } from "../../utils/modelProviderHelpers";

/**
 * Whether a credential field holds a secret, by the same test the read path
 * masks with. That shared test is the point: a value the server never shows
 * back is one no caller can resend.
 */
export const isSecretCredential = isSecretCredentialField;

/**
 * The credential bag to store, given what a write carries and what the row
 * already holds.
 *
 * Three rules, and the read path is what separates them:
 *
 * - A field carrying the masked placeholder is one the drawer displayed and
 *   the customer left alone, so the stored value comes back.
 * - A **secret** the write leaves out is kept. Secrets are masked on read, so
 *   no caller can resend one it did not type, and leaving one out therefore
 *   cannot mean "delete it" — it means "I am not editing that". Without this,
 *   a write that names one field of a multi-field provider (rotating an Azure
 *   endpoint, say) deletes the API key it never mentioned, and the provider
 *   stops working with nothing on screen to explain why.
 * - Anything else left out is dropped, because a write states the visible
 *   configuration in full. Azure's API-Gateway toggle is exactly that: it
 *   saves the two gateway fields and leaves the direct ones out, and the
 *   presence of `AZURE_API_GATEWAY_BASE_URL` is what routes through the
 *   gateway. Preserving those would make the toggle unable to switch back.
 *
 * Clearing a secret on purpose still works: the field is sent empty, which
 * names it, and an empty value replaces the stored one.
 *
 * A placeholder with nothing behind it is dropped rather than stored as a
 * literal value, the same rule the extra-header merge follows. The drawer
 * shows the placeholder for a secret field whenever the row is enabled and
 * carries no readable credentials, so a save from there would otherwise store
 * `HAS_KEY...` as the API key and the provider would fail on every request
 * with a credential that was never real.
 */
export function mergeStoredCustomKeys({
  incoming,
  stored,
}: {
  incoming: Record<string, unknown> | null;
  stored: Record<string, unknown> | null;
}): Record<string, unknown> {
  // A masked field carries no value of its own. Either the stored one comes
  // back through `preserved` below, or there is nothing behind it and the
  // placeholder must not be stored as though it were a credential.
  const edited = Object.fromEntries(
    Object.entries(incoming ?? {}).filter(
      ([, value]) => value !== MASKED_KEY_PLACEHOLDER,
    ),
  );

  if (!stored) return edited;

  const preserved = Object.entries(stored).filter(([key, value]) => {
    if (incoming && key in incoming) {
      return incoming[key] === MASKED_KEY_PLACEHOLDER;
    }
    return isSecretCredential(key) && value !== "" && value != null;
  });

  return { ...edited, ...Object.fromEntries(preserved) };
}

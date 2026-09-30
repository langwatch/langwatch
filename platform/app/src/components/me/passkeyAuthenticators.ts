/**
 * What made a passkey, from the one identifier that says so.
 *
 * A passkey registered from the sign-up screen is named for the address it was
 * created for, because that is the only string the ceremony had — so somebody
 * with three of them reads three copies of their own email and cannot tell the
 * work laptop from the phone they no longer own. Renaming has always been
 * there; nobody uses it, because the list gives them nothing to rename FROM.
 *
 * WebAuthn hands back an AAGUID: an identifier for the authenticator MODEL.
 * It names a product — iCloud Keychain, 1Password, a YubiKey 5 — never a
 * device and never a person, so it is safe to show and it is exactly the
 * distinction the reader is trying to make.
 *
 * BEST EFFORT ON PURPOSE. The registry is a community list and no lookup can
 * be complete: an authenticator we do not recognise, or one that reports
 * nothing, falls back to the plain word. That is why this decides a LABEL and
 * nothing else — it is a starting point for a name somebody edits, and being
 * wrong costs a rename rather than a wrong decision.
 *
 * Lower-cased on lookup, because implementations differ on the case of the
 * hex and a map that only matched one of them would silently answer nothing
 * for half the population.
 */
const AUTHENTICATORS: Record<string, string> = {
  // Apple
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
  "771b48fd-d3d4-4f74-9232-fc157ab0507a": "Edge on Mac",

  // Google
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "b93fd961-f2e6-462f-b122-82002247de78": "Android",

  // Microsoft
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",

  // Password managers
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
  "0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6": "Keeper",
  "f3809540-7f14-49c1-a8b3-8f813b225541": "Enpass",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",

  // Security keys
  "cb69481e-8ff7-4039-93ec-0a2729a154a8": "YubiKey 5",
  "ee882879-721c-4913-9775-3dfcce97072a": "YubiKey 5",
  "fa2b99dc-9e39-4257-8f92-4a30d23c4118": "YubiKey 5 NFC",
  "2fc0579f-8113-47ea-b116-bb5a8db9202a": "YubiKey 5 NFC",
  "73bb0cd4-e502-49b8-9c6f-b59445bf720b": "YubiKey 5 FIPS",
  "c1f9a0bc-1dd2-404a-b27f-8e29047a43fd": "YubiKey 5 FIPS",
  "d8522d9f-575b-4866-88a9-ba99fa02f35b": "YubiKey Bio",
  "39a5647e-1853-446c-a1f6-a79bae9f5bc7": "IDmelon",
};

/** The authenticator's product name, where we recognise it. */
export function authenticatorName(aaguid: string | null | undefined) {
  if (!aaguid) return null;
  // The all-zero AAGUID is what an authenticator reports when it declines to
  // identify its model. It is an answer, and the answer is "not saying".
  const key = aaguid.trim().toLowerCase();
  if (!key || /^0+(-0+)*$/.test(key)) return null;
  return AUTHENTICATORS[key] ?? null;
}

/** What the plugin stores per credential, of the parts a label needs. */
export interface LabelledPasskey {
  name?: string | null;
  aaguid?: string | null;
}

/**
 * What to call one in a list of them.
 *
 * A name somebody typed always wins — it is the whole point of renaming. The
 * one exception is a name that is just the account's own address, which is
 * not a name anybody chose: it is what the sign-up ceremony had to hand, and
 * it is identical on every passkey the account holds. Recognising the
 * authenticator beats repeating the reader's email back at them three times.
 */
export function passkeyLabel(
  passkey: LabelledPasskey,
  { accountAddress }: { accountAddress?: string | null } = {},
): string {
  const given = passkey.name?.trim();
  const isAddress = !!given && given.includes("@");
  const isOwnAddress =
    isAddress &&
    (!accountAddress ||
      given.toLowerCase() === accountAddress.trim().toLowerCase());

  if (given && !isOwnAddress) return given;

  return authenticatorName(passkey.aaguid) ?? given ?? "Passkey";
}

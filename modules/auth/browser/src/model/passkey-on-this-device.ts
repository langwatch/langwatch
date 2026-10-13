/**
 * Whether this browser has signed in with or made a passkey. A bare "1": no
 * address or account id, since an address lookup would say who has an account.
 * Same device-local store as `last-used-method.ts`.
 */
const STORAGE_KEY = "langwatch.auth.passkey-on-this-device";

export function readPasskeyOnThisDevice(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberPasskeyOnThisDevice(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // A browser that will not store it keeps the address field's autofill.
    return;
  }
}

/** Test seam, and the one place the key is written down. */
export const PASSKEY_ON_THIS_DEVICE_STORAGE_KEY = STORAGE_KEY;

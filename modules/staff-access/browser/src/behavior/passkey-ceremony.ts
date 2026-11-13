/** Asks the browser for a passkey signature over the server's options (user verification on). */

import type { StaffAccessEnrolInput } from "@langwatch/staff-access-contract";
import { startAuthentication, type AuthenticatorTransportFuture } from "@simplewebauthn/browser";

/** What the server's `*Options` procedures answer: `PublicKeyCredentialRequestOptionsJSON`. */
export type StaffAccessAssertionOptions = {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: "required";
  allowCredentials: { id: string; type: "public-key"; transports?: string[] | undefined }[];
};

const TRANSPORTS: ReadonlySet<string> = new Set<AuthenticatorTransportFuture>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

function isTransport(value: string): value is AuthenticatorTransportFuture {
  return TRANSPORTS.has(value);
}
/** `AuthenticationResponseJSON`, as the contract's assertion schema takes it. */
export type StaffAccessAssertionInput = StaffAccessEnrolInput["assertion"];

/** The operator closed the passkey prompt or it timed out; nothing reached the server. */
export class PasskeyCancelledError extends Error {
  constructor() {
    super("passkey_cancelled");
    this.name = "PasskeyCancelledError";
  }
}

export async function signWithPasskey(
  options: StaffAccessAssertionOptions,
): Promise<StaffAccessAssertionInput> {
  try {
    const response = await startAuthentication({
      optionsJSON: {
        ...options,
        allowCredentials: options.allowCredentials.map(({ id, type, transports }) => ({
          id,
          type,
          ...(transports ? { transports: transports.filter(isTransport) } : {}),
        })),
      },
    });
    return {
      id: response.id,
      rawId: response.rawId,
      type: "public-key",
      response: {
        clientDataJSON: response.response.clientDataJSON,
        authenticatorData: response.response.authenticatorData,
        signature: response.response.signature,
        ...(response.response.userHandle ? { userHandle: response.response.userHandle } : {}),
      },
      ...(response.authenticatorAttachment
        ? { authenticatorAttachment: response.authenticatorAttachment }
        : {}),
      clientExtensionResults: { ...response.clientExtensionResults },
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NotAllowedError" || error.name === "AbortError")
    ) {
      throw new PasskeyCancelledError();
    }
    throw error;
  }
}

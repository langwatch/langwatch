import { type CliDeviceFlowRefusal, CliDeviceFlowRefusedError } from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";

/**
 * The RFC 8628 body and status a device-grant caller is answered with for any
 * failure. A flow refusal is its own body; any other handled refusal carries its
 * code in `error`; anything unhandled is a 500 that says nothing more.
 */
export function cliDeviceFlowRefusalDocument(
  failure: Error,
): Readonly<{ status: number; refusal: CliDeviceFlowRefusal }> {
  if (failure instanceof CliDeviceFlowRefusedError) {
    return { status: failure.httpStatus ?? 400, refusal: failure.refusal };
  }

  if (HandledError.isHandled(failure)) {
    return {
      status: failure.httpStatus ?? 500,
      refusal: { error: failure.code, error_description: failure.message },
    };
  }

  return {
    status: 500,
    refusal: { error: "server_error", error_description: "The request could not be completed" },
  };
}

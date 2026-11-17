// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A platform refused a kill switch call. `code` is stable (`http_404`, `ThrottlingException`) and
 * is what the stop records; the message goes to the log only.
 */
export class KillSwitchPlatformError extends Error {
  readonly code: string;

  constructor({ code, message }: { code: string; message: string }) {
    super(message);
    this.name = "KillSwitchPlatformError";
    this.code = code;
  }
}

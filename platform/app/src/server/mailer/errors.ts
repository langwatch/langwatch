import { HandledError } from "@langwatch/handled-error";

/**
 * An email was asked for on an installation with no email provider set up.
 * Nothing the caller changes makes it send; an administrator has to configure
 * a provider, so the copy says so instead of reading as a crash.
 */
export class EmailProviderNotConfiguredError extends HandledError {
  declare readonly code: "email_provider_not_configured";

  constructor() {
    super(
      "email_provider_not_configured",
      "No email provider is configured on this installation, so no email was sent.",
      { httpStatus: 422, fault: "customer" },
    );
    this.name = "EmailProviderNotConfiguredError";
  }
}

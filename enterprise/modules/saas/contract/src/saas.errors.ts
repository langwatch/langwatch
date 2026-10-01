// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { HandledError } from "@langwatch/handled-error";

/** Asked of a deployment that is not LangWatch Cloud, which answers none of Cloud's own routes. */
export class LangWatchCloudOnlyError extends HandledError {
  declare readonly code: "langwatch_cloud_only";

  constructor() {
    super("langwatch_cloud_only", "Only LangWatch Cloud answers this", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "LangWatchCloudOnlyError";
  }
}

/** One install, or everyone at once, posted more usage reports than the receiver takes. */
export class UsageReportRateLimitedError extends HandledError {
  declare readonly code: "rate_limited";

  constructor() {
    super("rate_limited", "Too many usage reports", {
      httpStatus: 429,
      retryable: true,
      fault: "customer",
    });
    this.name = "UsageReportRateLimitedError";
  }
}

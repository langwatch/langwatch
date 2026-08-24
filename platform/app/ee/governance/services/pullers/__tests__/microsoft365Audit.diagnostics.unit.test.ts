/**
 * Unit coverage for the two extractors that turn a Management Activity API
 * failure into something a log line can say.
 *
 * Every setup mistake this API can report answers 400 with the same status
 * text, and `HttpResponseError` keeps the body out of `message` on purpose.
 * So the code and the detail below are the entire difference between "the
 * source is broken" and "this tenant owns no Microsoft 365".
 *
 * The bodies here are not invented. Each is the shape observed against the
 * live API, which is the point: the reason the `AF` scan runs ahead of the
 * documented `error.code` field is that `error.code` was seen holding a
 * 200-character diagnostic dump, truncated mid-token, with the remainder
 * spilled into `message`. A fixture written from the documentation would have
 * agreed with the old order and missed it.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */
import { describe, expect, it } from "vitest";

import {
  managementApiErrorCode,
  managementApiErrorDetail,
} from "../microsoft365Audit.puller";
import { HttpResponseError } from "../shared/httpRetry";

const TENANT = "3807ec24-0000-0000-0000-000000000000";
const APP = "80f513d2-0000-0000-0000-000000000000";

const failure = (bodyText: string) =>
  new HttpResponseError({
    status: 400,
    statusText: "",
    url: "https://manage.office.com/api/v1.0/tenant/activity/feed/subscriptions/start",
    bodyText,
  });

/**
 * A tenant with no Microsoft 365 estate. Observed live: no `AF` code
 * anywhere, `error.code` truncated mid-`ApplicationId`, and the only useful
 * sentence stranded at the front of `message` ahead of a server stack trace.
 */
const NO_TENANT_BODY = JSON.stringify({
  error: {
    code:
      `StartSubscription [CorrId=1f1eecd7-0000-0000-0000-000000000000]` +
      `[TenantId=${TENANT},ContentType=Audit.General,ApplicationId=${APP},` +
      `PublisherId=00000000-0000-0000-0000-000000000000][AppId`,
    message:
      `0f513d2-0000-0000-0000-000000000000] failed. Exception: ` +
      `Microsoft.Office.Compliance.Audit.DataServiceException: ` +
      `Tenant ${TENANT} does not exist.\r\n` +
      `   at Microsoft.Office.Compliance.Audit.API.AzureManager.` +
      `<GetSubscriptionAzureTableClientForTenantAsync>d__84.MoveNext()`,
  },
});

const ALREADY_ENABLED_BODY = JSON.stringify({
  error: {
    code: "AF20024",
    message: "The subscription is already enabled. No property change.",
  },
});

describe("given the API answered with its documented AF code", () => {
  describe("when the code is asked for", () => {
    it("returns the AF code", () => {
      expect(managementApiErrorCode(failure(ALREADY_ENABLED_BODY))).toBe(
        "AF20024",
      );
    });
  });

  describe("when the code sits only in the message text", () => {
    it("still finds it, because the field it belongs in is not reliable", () => {
      const body = JSON.stringify({
        error: { code: "", message: "Request failed with AF20023 for tenant." },
      });
      expect(managementApiErrorCode(failure(body))).toBe("AF20023");
    });
  });
});

describe("given a tenant that owns no Microsoft 365 estate", () => {
  describe("when the code is asked for", () => {
    it("reports no code rather than the diagnostic dump `error.code` holds", () => {
      // The regression this ordering exists for: taking `error.code` at its
      // word puts 200 characters of correlation ids into the log field meant
      // for a code.
      expect(managementApiErrorCode(failure(NO_TENANT_BODY))).toBeUndefined();
    });
  });

  describe("when the detail is asked for", () => {
    it("surfaces the sentence naming the cause, without the stack trace", () => {
      const detail = managementApiErrorDetail(failure(NO_TENANT_BODY));
      expect(detail).toContain(`Tenant ${TENANT} does not exist.`);
      expect(detail).not.toContain("MoveNext");
    });
  });
});

describe("given an error body in a shape the API does not document", () => {
  describe("when the code is a short non-AF string", () => {
    it("accepts it, since not every code this API sends is AF-prefixed", () => {
      const body = JSON.stringify({ error: { code: "InvalidContentType" } });
      expect(managementApiErrorCode(failure(body))).toBe("InvalidContentType");
    });
  });

  describe("when the body is not JSON and carries no AF code", () => {
    it("reports no code", () => {
      expect(
        managementApiErrorCode(failure("<html>gateway</html>")),
      ).toBeUndefined();
    });

    it("falls back to the raw body for the detail", () => {
      expect(managementApiErrorDetail(failure("Bad Gateway"))).toBe(
        "Bad Gateway",
      );
    });
  });

  describe("when the body is empty", () => {
    it("reports no detail rather than an empty one", () => {
      expect(managementApiErrorDetail(failure(""))).toBeUndefined();
    });
  });
});

describe("given a failure that is not an HTTP response at all", () => {
  describe("when either extractor is asked", () => {
    it("reports nothing rather than inventing a code", () => {
      const transport = new Error("socket hang up");
      expect(managementApiErrorCode(transport)).toBeUndefined();
      expect(managementApiErrorDetail(transport)).toBeUndefined();
    });
  });
});

describe("given an explanation far longer than a log line should carry", () => {
  describe("when the detail is asked for", () => {
    it("stops at the first line", () => {
      const body = JSON.stringify({
        error: { code: "AF20024", message: "First line.\r\nSecond line." },
      });
      expect(managementApiErrorDetail(failure(body))).toBe("First line.");
    });

    it("bounds a single unbroken line so it cannot fill the log entry", () => {
      const body = JSON.stringify({ error: { message: "x".repeat(5_000) } });
      expect(managementApiErrorDetail(failure(body))?.length).toBe(200);
    });
  });
});

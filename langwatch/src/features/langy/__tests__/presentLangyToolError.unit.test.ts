/**
 * The copy a failed tool call turns into.
 *
 * Three failures drove this file. The first said only "This step couldn't be
 * completed" while the reason sat in raw JSON only a developer would find. The
 * second reported a PLAN LIMIT as a permissions problem, because the card keyed
 * off `httpStatus: 403` rather than off the code — sending the reader to check
 * their permissions when the truth was they had used 3 of the 3 scenarios their
 * plan includes. The third is the one this file guards hardest: a code the panel
 * has no copy for must still name itself, because a code nobody can read is a
 * support thread nobody can close.
 *
 * @see specs/langy/langy-cli-tool-envelope.feature
 *      "A failure keeps its structure all the way to the card"
 */
import { describe, expect, it } from "vitest";
import { presentLangyToolError } from "../logic/langyToolFailure";

const failureDocument = (error: Record<string, unknown>) =>
  JSON.stringify({ ok: false, error });

const present = (errorText: unknown, title = "Creating scenario") =>
  presentLangyToolError({ title, errorText });

describe("presentLangyToolError", () => {
  describe("given a failure the platform refused on access", () => {
    const denial = failureDocument({
      code: "api_key_permission_denied",
      message: "API Key does not grant required permission: scenarios:manage",
      httpStatus: 403,
      meta: { permission: "scenarios:manage" },
      isHandled: true,
      suggestions: ["Ask an admin to raise your role"],
      docUrl: "https://docs.langwatch.ai/api-reference/api-keys",
    });

    // "You can't X here", not "you don't have permission to X". A denial means
    // the key-and-user intersection was empty, which is usually the caller
    // lacking the permission — but is also what a key that omits a permission
    // the caller DOES hold looks like. The response cannot separate the two, so
    // the card states the consequence, which is true either way.
    it("names what the reader cannot do, in plain words, in one sentence", () => {
      expect(present(denial).message).toBe(
        "You can't manage scenarios in this project.",
      );
    });

    it("never headlines the internal permission name", () => {
      const presentation = present(denial);
      expect(presentation.message).not.toContain("scenarios:manage");
      expect(presentation.message).not.toContain("API Key");
    });

    it("does not say the same thing again at a second altitude", () => {
      expect(present(denial).detail).not.toContain("manage scenarios");
    });

    // They did not issue the key Langy acts through and cannot re-scope it —
    // the system mints it from their own permissions.
    it("points at the one person who can change it, and offers no link", () => {
      const presentation = present(denial);
      expect(presentation.detail).toBe(
        "Ask whoever manages access for your team if you need it.",
      );
      expect(presentation.docsUrl).toBeUndefined();
    });

    // The remediation channel is written for an API consumer holding their own
    // key. Nobody chatting in the panel issued one — Langy mints its own.
    it("drops next steps that are addressed to somebody else", () => {
      expect(present(denial).tips).toBeUndefined();
    });

    it("keeps the whole failure available to copy", () => {
      expect(present(denial).raw).toContain("api-reference/api-keys");
    });

    it("names what failed in the title", () => {
      expect(present(denial).title).toBe("Creating scenario failed");
    });

    it("marks it terminal so nothing retries a refusal", () => {
      expect(present(denial).terminal).toBe(true);
    });
  });

  describe("given a denial that named no permission", () => {
    it("still says the access does not cover it, with no invented detail", () => {
      const presentation = present(
        failureDocument({
          code: "unauthorized",
          message: "Forbidden",
          httpStatus: 403,
          meta: {},
          isHandled: true,
        }),
      );
      expect(presentation.message).toBe(
        "This action isn't available to you in this project.",
      );
      expect(presentation.message).not.toContain("API key");
    });
  });

  // The failure the user hit: a free-plan scenario limit, rendered as
  // "Your access in this project doesn't cover this action."
  describe("given a plan limit the platform refused on", () => {
    const limitFailure = (meta: Record<string, unknown>) =>
      failureDocument({
        code: "resource_limit_exceeded",
        kind: "resource_limit_exceeded",
        message:
          "Free plan limit of 3 scenarios reached. To increase your limits, upgrade your plan at https://app.langwatch.ai/settings/subscription",
        httpStatus: 403,
        meta,
        isHandled: true,
      });

    const atLimit = limitFailure({ limitType: "scenarios", current: 3, max: 3 });

    it("says the plan ran out, not that the access did", () => {
      expect(present(atLimit).message).toBe(
        "Your plan includes 3 scenarios, and all 3 are in use.",
      );
    });

    it("never describes a plan limit as a permissions problem", () => {
      expect(present(atLimit).message).not.toContain("access");
    });

    it("reports what ran out in the customer's words, never limitType", () => {
      expect(present(atLimit).limit).toMatchObject({
        label: "scenarios",
        current: 3,
        max: 3,
      });
      expect(present(atLimit).message).not.toContain("limitType");
    });

    it("counts below the ceiling read as a count, not as exhausted", () => {
      const partial = limitFailure({
        limitType: "datasets",
        current: 1,
        max: 3,
      });
      expect(present(partial).message).toBe(
        "You're using 1 of the 3 datasets your plan includes.",
      );
    });

    it("names a limit type the label table has never heard of in plain words", () => {
      const scenarioSets = failureDocument({
        code: "scenario_set_limit_exceeded",
        message: "You have reached the maximum number of scenario sets",
        httpStatus: 403,
        meta: { limitType: "scenarioSets", current: 2, max: 2 },
        isHandled: true,
      });
      expect(present(scenarioSets).limit?.label).toBe("scenario sets");
    });

    it("marks it terminal — no argument change can make room", () => {
      expect(present(atLimit).terminal).toBe(true);
    });

    it("still shows the code so it can be quoted", () => {
      expect(present(atLimit).code).toBe("resource_limit_exceeded");
    });
  });

  describe("given a 403 that is neither a denial nor a limit", () => {
    it("keeps the platform's own sentence rather than blaming access", () => {
      const blocked = failureDocument({
        code: "policy_violation",
        message: "The request was blocked by a content policy.",
        httpStatus: 403,
        meta: {},
        isHandled: true,
      });
      expect(present(blocked).message).toBe(
        "The request was blocked by a content policy.",
      );
      expect(present(blocked).code).toBe("policy_violation");
    });
  });

  describe("given a failure the platform explained itself", () => {
    const notFound = failureDocument({
      code: "dataset_not_found",
      message: "Dataset support-questions does not exist",
      httpStatus: 404,
      meta: {},
      isHandled: true,
    });

    it("keeps the platform's own sentence", () => {
      expect(present(notFound, "Loading dataset").message).toBe(
        "Dataset support-questions does not exist",
      );
    });

    // Remediation for a domain failure IS for this reader — it is about the
    // data, not about whoever holds a key.
    it("keeps next steps that apply to whoever is reading", () => {
      const withTips = failureDocument({
        code: "trace_not_found",
        message: "That trace is no longer available",
        httpStatus: 404,
        meta: {},
        isHandled: true,
        suggestions: ["Traces are removed after the retention window"],
      });
      expect(present(withTips, "Loading trace").tips).toEqual([
        "Traces are removed after the retention window",
      ]);
    });

    it("shows the code alongside it", () => {
      expect(present(notFound, "Loading dataset").code).toBe(
        "dataset_not_found",
      );
    });
  });

  // A code with no copy in this module is the case that used to render as a
  // shrug. It must name itself: that string is the only handle support has.
  describe("given a code the panel has no copy for", () => {
    const unknown = failureDocument({
      code: "clickhouse_unavailable",
      message: "Analytics storage is temporarily unavailable.",
      httpStatus: 503,
      meta: {},
      isHandled: false,
    });

    it("shows the platform's sentence as the headline", () => {
      expect(present(unknown, "Counting traces").message).toBe(
        "Analytics storage is temporarily unavailable.",
      );
    });

    it("shows the code verbatim", () => {
      expect(present(unknown, "Counting traces").code).toBe(
        "clickhouse_unavailable",
      );
    });

    it("does not call an infrastructure failure terminal", () => {
      expect(present(unknown, "Counting traces").terminal).toBeUndefined();
    });
  });

  describe("given a failure with no structure at all", () => {
    const stderr = "✖ Failed to reach the API: socket hang up (ECONNRESET)";

    it("names what failed", () => {
      expect(present(stderr).title).toBe("Creating scenario failed");
    });

    it("shows the text it was given rather than swallowing it", () => {
      expect(present(stderr).detail).toBe(
        "Failed to reach the API: socket hang up (ECONNRESET)",
      );
    });

    it("claims no code it was never given", () => {
      expect(present(stderr).code).toBeUndefined();
    });

    it("keeps the whole text for copying", () => {
      expect(present(stderr).raw).toContain("ECONNRESET");
    });
  });
});

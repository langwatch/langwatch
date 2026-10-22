// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What staff may keep as a notice: the bounds an install holds a received notice to.
 * Spec: enterprise/modules/licensing/specs/self-hosted-notices.feature
 */
import { describe, expect, it } from "vitest";

import {
  createSelfHostedNoticeInputSchema,
  updateSelfHostedNoticeInputSchema,
} from "../self-hosted-notice.ts";

const valid = {
  severity: "security",
  title: "Upgrade to 3.4.2",
  body: "A vulnerability is fixed in 3.4.2.",
  url: "https://langwatch.ai/security",
  fixedIn: "3.4.2",
  expiresAt: null,
};

function refusedFields(schema: typeof createSelfHostedNoticeInputSchema, input: object): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("a self-hosted notice", () => {
  describe("when staff create or edit one that breaks a bound", () => {
    /** @scenario "A notice is validated before it is kept" */
    it.each([
      ["an empty title", { title: "  " }, "title"],
      ["a title over 120 characters", { title: "x".repeat(121) }, "title"],
      ["a body over 2000 characters", { body: "x".repeat(2001) }, "body"],
      ["a link that is not https", { url: "http://langwatch.ai/security" }, "url"],
      ["a fixed-in that is not a release name", { fixedIn: "next week" }, "fixedIn"],
    ])("refuses %s, naming the field", (_case, change, field) => {
      expect(refusedFields(createSelfHostedNoticeInputSchema, { ...valid, ...change })).toEqual([
        field,
      ]);
      expect(
        updateSelfHostedNoticeInputSchema.validate({ id: "n1", ...valid, ...change }),
      ).toBe(false);
    });
  });

  it("keeps a notice inside every bound, with no link, release or expiry", () => {
    expect(
      createSelfHostedNoticeInputSchema.validate({
        ...valid,
        url: null,
        fixedIn: null,
        expiresAt: null,
      }),
    ).toBe(true);
    expect(
      createSelfHostedNoticeInputSchema.validate({ ...valid, fixedIn: "v3.4.2" }),
    ).toBe(true);
  });
});

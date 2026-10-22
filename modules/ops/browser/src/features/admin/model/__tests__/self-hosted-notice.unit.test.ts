/**
 * The notice form's checks, said before the server refuses a notice an install would drop.
 * Spec: enterprise/modules/licensing/specs/self-hosted-notices.feature
 */
import { SELF_HOSTED_NOTICE_BODY_MAX, SELF_HOSTED_NOTICE_TITLE_MAX } from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import {
  emptyNoticeDraft,
  noticeProblemsOf,
  noticeStatusOf,
  type NoticeDraft,
} from "../self-hosted-notice.ts";

const draftOf = (fields: Partial<NoticeDraft>): NoticeDraft => ({
  ...emptyNoticeDraft(),
  title: "LangWatch 4.0 is out",
  ...fields,
});

describe("noticeProblemsOf", () => {
  describe("given a complete draft", () => {
    it("names no problem", () => {
      const draft = draftOf({
        url: "https://langwatch.ai/changelog",
        fixedIn: "v3.4.2",
        expiresOn: "2026-11-01",
      });
      expect(noticeProblemsOf(draft, "2026-11-01T11:00:00.000Z")).toEqual({});
    });
  });

  describe("given a draft breaking one bound", () => {
    it.each([
      ["a blank title", { title: "   " }, "title"],
      ["a title over the limit", { title: "t".repeat(SELF_HOSTED_NOTICE_TITLE_MAX + 1) }, "title"],
      ["a body over the limit", { body: "b".repeat(SELF_HOSTED_NOTICE_BODY_MAX + 1) }, "body"],
      ["an http link", { url: "http://langwatch.ai" }, "url"],
      ["an https link with no address", { url: "https://" }, "url"],
      ["an https link with a space in its host", { url: "https://lang watch.ai" }, "url"],
      ["a fixed-in that is not a release", { fixedIn: "next week" }, "fixedIn"],
    ] as const)("names %s", (_, fields, field) => {
      expect(Object.keys(noticeProblemsOf(draftOf(fields), null))).toEqual([field]);
    });

    it("names an expiry date that could not be read", () => {
      expect(Object.keys(noticeProblemsOf(draftOf({ expiresOn: "2026-13-45" }), null))).toEqual([
        "expiresOn",
      ]);
    });
  });
});

describe("noticeStatusOf", () => {
  const now = Date.UTC(2026, 9, 22);

  it("reads Expired for a published notice past its expiry, since it is no longer sent", () => {
    expect(
      noticeStatusOf({ status: "published", expiresAt: "2026-10-21T12:00:00.000Z" }, now).label,
    ).toBe("Expired");
  });

  it("reads the stored status otherwise", () => {
    expect(noticeStatusOf({ status: "published", expiresAt: null }, now).label).toBe("Published");
    expect(
      noticeStatusOf({ status: "withdrawn", expiresAt: "2026-10-21T12:00:00.000Z" }, now).label,
    ).toBe("Withdrawn");
  });
});

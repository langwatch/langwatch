/** A notice LangWatch staff send self-hosted installs, as Cloud admin reads it
 * (self-hosted-notices.feature). Declared here, not derived from `RouterOutputs`:
 * model stays pure and behavior depends on it, never the reverse. */

import {
  SELF_HOSTED_NOTICE_BODY_MAX,
  SELF_HOSTED_NOTICE_RELEASE_PATTERN,
  SELF_HOSTED_NOTICE_SEVERITIES,
  SELF_HOSTED_NOTICE_TITLE_MAX,
  type SelfHostedNoticeSeverity,
} from "@langwatch/ops-contract";
import { toEpochMs, toZonedDateTime } from "@langwatch/time";

export type SelfHostedNoticeStatus = "draft" | "published" | "withdrawn";

export interface SelfHostedNoticeRow {
  id: string;
  severity: SelfHostedNoticeSeverity;
  title: string;
  body: string;
  url: string | null;
  fixedIn: string | null;
  status: SelfHostedNoticeStatus;
  expiresAt: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export { SELF_HOSTED_NOTICE_SEVERITIES };

export const SEVERITY_LABELS: Record<SelfHostedNoticeSeverity, string> = {
  info: "Info",
  warning: "Warning",
  security: "Security",
};

export const SEVERITY_PALETTE: Record<SelfHostedNoticeSeverity, string> = {
  info: "blue",
  warning: "orange",
  security: "red",
};

export const STATUS_LABELS: Record<SelfHostedNoticeStatus, string> = {
  draft: "Draft",
  published: "Published",
  withdrawn: "Withdrawn",
};

export const STATUS_PALETTE: Record<SelfHostedNoticeStatus, string> = {
  draft: "gray",
  published: "green",
  withdrawn: "orange",
};

/** The status staff see: a published notice past its expiry is no longer sent, so reads Expired. */
export function noticeStatusOf(
  notice: Pick<SelfHostedNoticeRow, "status" | "expiresAt">,
  nowMs: number,
): { label: string; palette: string } {
  if (notice.status === "published" && notice.expiresAt && toEpochMs(notice.expiresAt) <= nowMs) {
    return { label: "Expired", palette: "gray" };
  }
  return { label: STATUS_LABELS[notice.status], palette: STATUS_PALETTE[notice.status] };
}

/** The form as staff type it: every field a string, the expiry a calendar day. */
export interface NoticeDraft {
  severity: SelfHostedNoticeSeverity;
  title: string;
  body: string;
  url: string;
  fixedIn: string;
  expiresOn: string;
}

export type NoticeProblems = Partial<Record<keyof NoticeDraft, string>>;

export function emptyNoticeDraft(): NoticeDraft {
  return { severity: "info", title: "", body: "", url: "", fixedIn: "", expiresOn: "" };
}

export function draftOfNotice(notice: SelfHostedNoticeRow): NoticeDraft {
  return {
    severity: notice.severity,
    title: notice.title,
    body: notice.body,
    url: notice.url ?? "",
    fixedIn: notice.fixedIn ?? "",
    expiresOn: notice.expiresAt ? toZonedDateTime(notice.expiresAt).toPlainDate().toString() : "",
  };
}

/** What the wire schema's `z.url({ protocol: /^https$/ })` takes: a parseable https address. */
function isHttpsAddress(url: string): boolean {
  if (!URL.canParse(url)) return false;
  return new URL(url).protocol === "https:";
}

/** The bounds an install holds a received notice to, said before the server refuses them. */
export function noticeProblemsOf(draft: NoticeDraft, expiresAt: string | null): NoticeProblems {
  const problems: NoticeProblems = {};
  const title = draft.title.trim();
  if (!title) problems.title = "Give the notice a title.";
  else if (title.length > SELF_HOSTED_NOTICE_TITLE_MAX)
    problems.title = `Keep the title to ${SELF_HOSTED_NOTICE_TITLE_MAX} characters.`;
  if (draft.body.length > SELF_HOSTED_NOTICE_BODY_MAX)
    problems.body = `Keep the message to ${SELF_HOSTED_NOTICE_BODY_MAX} characters.`;
  const url = draft.url.trim();
  if (url && !isHttpsAddress(url)) problems.url = "Link to an https:// address.";
  const fixedIn = draft.fixedIn.trim();
  if (fixedIn && !SELF_HOSTED_NOTICE_RELEASE_PATTERN.test(fixedIn))
    problems.fixedIn = "Name a release, such as 3.4.2.";
  if (draft.expiresOn && !expiresAt) problems.expiresOn = "Choose a valid date.";
  return problems;
}

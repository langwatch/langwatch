/**
 * A notice LangWatch sends every self-hosted install in the reply to its daily
 * usage report. The install owns this wire, so the receiver imports it.
 * @see ../../specs/self-hosted-notices.feature
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

export const SELF_HOSTED_NOTICE_SEVERITIES = ["info", "warning", "security"] as const;

export type SelfHostedNoticeSeverity = (typeof SELF_HOSTED_NOTICE_SEVERITIES)[number];

export const SELF_HOSTED_NOTICE_TITLE_MAX = 120;
export const SELF_HOSTED_NOTICE_BODY_MAX = 2000;

/** A release name as the install compares it: `3.4.2`, optionally `v`-prefixed. */
export const SELF_HOSTED_NOTICE_RELEASE_PATTERN = /^v?\d+\.\d+\.\d+$/;

const selfHostedNoticeSchemaDefinition = z.object({
  id: z.string().min(1),
  severity: z.enum(SELF_HOSTED_NOTICE_SEVERITIES),
  title: z.string().min(1).max(SELF_HOSTED_NOTICE_TITLE_MAX),
  body: z.string().max(SELF_HOSTED_NOTICE_BODY_MAX),
  url: z.url({ protocol: /^https$/ }).nullable(),
  /** The release that fixes what the notice is about; an install on it or newer hides it. */
  fixed_in: z.string().regex(SELF_HOSTED_NOTICE_RELEASE_PATTERN).nullable(),
  published_at: z.iso.datetime({ offset: true }),
});
export interface SelfHostedNoticeSchema extends Named<typeof selfHostedNoticeSchemaDefinition> {}
export const selfHostedNoticeSchema: SelfHostedNoticeSchema = selfHostedNoticeSchemaDefinition;

export type SelfHostedNotice = z.infer<typeof selfHostedNoticeSchema>;

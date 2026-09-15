/**
 * The support-inbox row, restated so no port, service or transport names the
 * generated client. Mirrors `packages/prisma-client/prisma/schema.prisma` and
 * moves with it.
 */

import type { Instant } from "@langwatch/time";
import { z } from "zod";

/** A Json column's value, mirroring the generated client's own shape. */
export type BugReportJsonObject = { [Key in string]?: BugReportJsonValue };
export type BugReportJsonArray = BugReportJsonValue[];
export type BugReportJsonValue =
  | string
  | number
  | boolean
  | BugReportJsonObject
  | BugReportJsonArray
  | null;

export type BugReport = {
  id: string;
  createdAt: Instant;
  source: string;
  kind: string;
  title: string;
  summary: string | null;
  sessionData: string | null;
  sessionTruncated: boolean;
  agent: string | null;
  contactEmail: string | null;
  cliVersion: string | null;
  linkedProjectId: string | null;
  metadata: BugReportJsonValue | null;
};

/** The columns a filed report is written with. */
export type BugReportCreateInput = {
  source: string;
  kind: string;
  title: string;
  summary?: string | null;
  sessionData?: string | null;
  sessionTruncated?: boolean;
  agent?: string | null;
  contactEmail?: string | null;
  cliVersion?: string | null;
  linkedProjectId?: string | null;
  metadata?: BugReportJsonValue | null;
};

/**
 * The stored instant, as the time package models it. Nothing on the wire is
 * decided here: the row already carries a real instant, and this schema only
 * says which field it is.
 */
const bugReportInstantSchema = z.custom<Instant>((value) => value !== null && value !== undefined);

/**
 * One inbox row as the back office lists it, WITHOUT the stored transcript:
 * `sessionData` is the whole session a reporter attached, and carrying every
 * transcript on a page would be the listing's whole payload.
 */
export const bugReportRowSchema = z.object({
  id: z.string(),
  createdAt: bugReportInstantSchema,
  source: z.string(),
  kind: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  sessionTruncated: z.boolean(),
  agent: z.string().nullable(),
  contactEmail: z.string().nullable(),
  cliVersion: z.string().nullable(),
  linkedProjectId: z.string().nullable(),
  metadata: z.unknown(),
});

/** One report in full, as opening it answers. */
export const bugReportSchema = z.object({
  ...bugReportRowSchema.shape,
  sessionData: z.string().nullable(),
});

/** One page of the inbox, with the count the pager renders. */
export const bugReportListingSchema = z.object({
  reports: bugReportRowSchema.array(),
  total: z.number(),
});
export type BugReportListing = z.infer<typeof bugReportListingSchema>;

/** One page of the inbox, newest first, optionally narrowed by a search term. */
export const listBugReportsInputSchema = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(50),
  search: z.string().max(200).optional(),
});
export type ListBugReportsInput = z.infer<typeof listBugReportsInputSchema>;

export const bugReportIdInputSchema = z.object({ id: z.string() });
export type BugReportIdInput = z.infer<typeof bugReportIdInputSchema>;

/**
 * The report a customer's coding agent posts, parsed by the intake route
 * itself because a rejected report answers the bespoke body released CLI and
 * MCP builds already read. The two size caps are the stored columns': an
 * oversized report is refused rather than truncated into an unreadable one.
 */
export const submitBugReportSchema = z
  .object({
    source: z.enum(["cli", "mcp"]),
    kind: z.enum(["summary", "full_session"]),
    title: z.string().trim().min(1).max(300),
    summary: z.string().max(200_000).optional(),
    sessionData: z.string().max(9_000_000).optional(),
    sessionTruncated: z.boolean().optional(),
    agent: z.string().max(100).optional(),
    contactEmail: z.string().max(320).optional(),
    cliVersion: z.string().max(50).optional(),
    metadata: z
      .record(z.string().max(200), z.union([z.string().max(2000), z.number(), z.boolean()]))
      .optional(),
  })
  .refine(
    (body) => (body.summary?.trim().length ?? 0) > 0 || (body.sessionData?.trim().length ?? 0) > 0,
    { message: "either summary or sessionData is required" },
  );
export type SubmitBugReport = z.infer<typeof submitBugReportSchema>;

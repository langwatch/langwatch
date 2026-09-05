/**
 * The support-inbox row, restated so no port, service or transport names the
 * generated client. Mirrors `packages/prisma-client/prisma/schema.prisma` and
 * moves with it.
 */

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
  createdAt: Date;
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

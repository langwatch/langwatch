/**
 * Keeps a finding's query only when the analytics module admits it for the run's person. A
 * kept query is replayed for a reader later, so one that does not validate is dropped and
 * its finding is filed without it.
 */

import type { AnalyticsApi, LangWatchQLProtections } from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import { Temporal } from "@langwatch/time";

import type { CheckedFinding } from "../rules/insight-daily-run-answer.rules.ts";

type InsightRunQueryMembers = Readonly<{
  analytics: Pick<AnalyticsApi, "resolveProtections" | "validateLangWatchQL">;
}>;

type Person = Readonly<{ projectId: string; userId: string }>;

function isoInstant(epochMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toString();
}

/** A refusal is an answer; any other failure is thrown for the run to retry. */
function refusedBy(error: unknown): false {
  if (!HandledError.isHandled(error)) throw error;
  return false;
}

export class InsightRunQueryService {
  private constructor(private readonly members: InsightRunQueryMembers) {}

  static create(members: InsightRunQueryMembers): InsightRunQueryService {
    return new InsightRunQueryService(members);
  }

  /** The findings as given, each without its query when the analytics module refuses it. */
  async keepValid({
    projectId,
    userId,
    window,
    findings,
  }: Person & {
    /** The window the query is replayed over, in epoch milliseconds. */
    window: { start: number; end: number };
    findings: readonly CheckedFinding[];
  }): Promise<CheckedFinding[]> {
    if (findings.every((finding) => finding.lwql === null)) return [...findings];
    const isValid = await this.validatorFor({ projectId, userId, window });
    return findings.map((finding) =>
      finding.lwql === null || isValid(finding.lwql) ? finding : { ...finding, lwql: null },
    );
  }

  /** Validates as the person reads: with their own protections, over the run's window. */
  private async validatorFor({
    projectId,
    userId,
    window,
  }: Person & { window: { start: number; end: number } }): Promise<(sql: string) => boolean> {
    const { analytics } = this.members;
    const protections = await this.protectionsOf({ projectId, userId });
    // No protections to validate against: no query is kept.
    if (protections === undefined) return () => false;
    const timeWindow = { start: isoInstant(window.start), end: isoInstant(window.end) };
    return (sql) => {
      try {
        analytics.validateLangWatchQL({ projectId, protections, sql, parameters: {}, timeWindow });
        return true;
      } catch (error) {
        return refusedBy(error);
      }
    };
  }

  private async protectionsOf(person: Person): Promise<LangWatchQLProtections | undefined> {
    try {
      return await this.members.analytics.resolveProtections(person);
    } catch (error) {
      refusedBy(error);
      return void 0;
    }
  }
}

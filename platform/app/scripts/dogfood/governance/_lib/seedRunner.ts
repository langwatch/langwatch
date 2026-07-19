/**
 * Generic runner for demo-org seed actions.
 *
 * The runner is the orchestration shell. Individual seed actions implement
 * the SeedAction contract; the runner enforces:
 *
 *   - dry-run is the default; mutations only run when execute=true
 *   - every action receives the same scope-asserted Organization handle
 *   - actions cannot bypass the scope assertion: the runner loads the org
 *     once, via the guard, and passes the resolved row down. An action that
 *     ignores the row and uses raw org ids skips the safety net by choice
 *     (caught in code review, not at runtime; structurally we provide the
 *     safe path)
 *   - every action's outcome is captured in the run report regardless of
 *     mode (dry-run actions report what they WOULD do)
 *   - one failing action does not stop the next; the report carries
 *     per-action error state and the runner returns a non-zero exit at the
 *     end if any action failed
 */

import type { Organization, PrismaClient } from "@prisma/client";
import { DemoOrgScope } from "./scopeGuard";

export type SeedActionOutcome =
  | { status: "succeeded"; summary: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: Error };

export interface SeedActionContext {
  prisma: PrismaClient;
  scope: DemoOrgScope;
  organization: Organization;
  execute: boolean;
}

export interface SeedAction {
  readonly name: string;
  run(context: SeedActionContext): Promise<SeedActionOutcome>;
}

export interface SeedRunReport {
  startedAt: string;
  completedAt: string;
  organizationId: string;
  organizationName: string;
  mode: "dry-run" | "execute";
  actions: Array<{
    name: string;
    outcome: SeedActionOutcome;
    durationMs: number;
  }>;
}

export async function runSeedActions(args: {
  prisma: PrismaClient;
  scope: DemoOrgScope;
  organizationId: string;
  actions: readonly SeedAction[];
  execute: boolean;
  now?: () => Date;
}): Promise<SeedRunReport> {
  const now = args.now ?? (() => new Date());
  const startedAt = now().toISOString();

  const organization = await args.scope.loadOrg(args.prisma, args.organizationId);

  const actionReports: SeedRunReport["actions"] = [];
  for (const action of args.actions) {
    const t0 = now().getTime();
    let outcome: SeedActionOutcome;
    try {
      outcome = await action.run({
        prisma: args.prisma,
        scope: args.scope,
        organization,
        execute: args.execute,
      });
    } catch (err) {
      outcome = {
        status: "failed",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
    const durationMs = now().getTime() - t0;
    actionReports.push({ name: action.name, outcome, durationMs });
  }

  return {
    startedAt,
    completedAt: now().toISOString(),
    organizationId: organization.id,
    organizationName: organization.name ?? "(unnamed)",
    mode: args.execute ? "execute" : "dry-run",
    actions: actionReports,
  };
}

export function reportHasFailures(report: SeedRunReport): boolean {
  return report.actions.some((a) => a.outcome.status === "failed");
}

export function formatReport(report: SeedRunReport): string {
  const lines: string[] = [];
  lines.push(`Demo seed run report`);
  lines.push(`====================`);
  lines.push(`Org: ${report.organizationName} (${report.organizationId})`);
  lines.push(`Mode: ${report.mode === "execute" ? "EXECUTE" : "DRY-RUN"}`);
  lines.push(`Started: ${report.startedAt}`);
  lines.push(`Completed: ${report.completedAt}`);
  lines.push("");
  lines.push(`Actions:`);
  for (const action of report.actions) {
    const o = action.outcome;
    let line = `  ${action.name} (${action.durationMs}ms): ${o.status}`;
    if (o.status === "succeeded") {
      line += ` ${o.summary}`;
    } else if (o.status === "skipped") {
      line += ` ${o.reason}`;
    } else {
      line += ` ${o.error.message}`;
    }
    lines.push(line);
  }
  if (reportHasFailures(report)) {
    lines.push("");
    lines.push(`Result: at least one action failed.`);
  } else {
    lines.push("");
    lines.push(`Result: all actions ran clean.`);
  }
  return lines.join("\n");
}

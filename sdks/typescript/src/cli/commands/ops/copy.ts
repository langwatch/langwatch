import chalk from "chalk";

import { getEndpoint } from "../../utils/endpoint";
import { commandValidationError } from "../../utils/errorOutput";
import { formatTable, sanitizeTerminalText } from "../../utils/formatting";
import { createPkcePair, describeMachine } from "../../utils/opsSession";
import type { CommandResult } from "../../utils/output";
import { requireRequesterKey, staffAccessFetch } from "./_shared";
import { refuseUndecided, waitForDecision } from "./access";

interface CreatedRequest {
  requestId: string;
  approvalUrl: string;
  expiresAt: string;
}

interface Redeemed {
  opsToken?: string;
}

interface CopyItem {
  kind: string;
  name: string;
  outcome: string;
  reason: string | null;
}

interface CopyReport {
  source: { slug: string; name: string };
  target: { slug: string; name: string };
  dryRun: boolean;
  items: CopyItem[];
  stoppedBecause?: string | null;
  totals: Record<string, number>;
}

type Side = Readonly<{
  label: "source" | "target";
  organization: string;
  counterpartOrganization: string;
  scopes: string[];
}>;

/** One approved, redeemed side of a copy: its request and the ops token it was given. */
type Approved = Readonly<{ requestId: string; opsToken: string }>;

const validationError = (message: string): Error =>
  Object.assign(new Error(message), commandValidationError(message));

/** Asks for one side's approval and answers its request with the verifier kept here. */
const requestSide = async ({
  side,
  reason,
  requesterKey,
  endpoint,
}: {
  side: Side;
  reason: string;
  requesterKey: string;
  endpoint: string;
}) => {
  const { codeVerifier, codeChallenge } = createPkcePair();
  const created = await staffAccessFetch<CreatedRequest>({
    method: "POST",
    path: "/api/staff-access/requests",
    bearer: requesterKey,
    body: {
      scopes: side.scopes,
      organization: side.organization,
      counterpartOrganization: side.counterpartOrganization,
      reason,
      codeChallenge,
      codeChallengeMethod: "S256",
      machine: describeMachine(),
    },
    endpoint,
  });
  console.error(chalk.bold(`Approve the ${side.label} (${side.organization}) with your passkey:`));
  console.error(`  ${chalk.cyan(created.approvalUrl)}`);
  return { created, codeVerifier };
};

const approveSide = async ({
  created,
  codeVerifier,
  requesterKey,
  endpoint,
}: {
  created: CreatedRequest;
  codeVerifier: string;
  requesterKey: string;
  endpoint: string;
}): Promise<Approved> => {
  const status = await waitForDecision({
    requestId: created.requestId,
    endpoint,
    requesterKey,
    expiresAt: created.expiresAt,
  });
  if (status !== "approved") refuseUndecided({ requestId: created.requestId, status });
  const redeemed = await staffAccessFetch<Redeemed>({
    method: "POST",
    path: `/api/staff-access/requests/${encodeURIComponent(created.requestId)}/redeem`,
    bearer: requesterKey,
    body: { codeVerifier },
    endpoint,
  });
  if (!redeemed.opsToken) {
    throw validationError(`Request ${created.requestId} was redeemed without an ops token.`);
  }
  return { requestId: created.requestId, opsToken: redeemed.opsToken };
};

/** Ends a copy session; one that already ended has nothing left to revoke. */
const endSide = async ({
  requestId,
  requesterKey,
  endpoint,
}: {
  requestId: string;
  requesterKey: string;
  endpoint: string;
}): Promise<void> => {
  await staffAccessFetch<unknown>({
    method: "POST",
    path: `/api/staff-access/requests/${encodeURIComponent(requestId)}/end`,
    bearer: requesterKey,
    body: {},
    endpoint,
  }).catch(() => undefined);
};

/**
 * `langwatch ops copy --from <org> --to <org>`: one approval per organization (`copy:source` and
 * `copy:target`, each naming the other organization), then the server-side copy. Both sessions
 * are ended afterwards; the tokens are never written to disk.
 */
export const opsCopyCommand = async ({
  from,
  to,
  projects,
  reason,
  dryRun,
}: {
  from: string;
  to: string;
  projects?: string;
  reason?: string;
  dryRun?: boolean;
}): Promise<CommandResult> => {
  const source = from.trim();
  const target = to.trim();
  if (!source || !target) throw validationError("Pass both --from and --to.");
  if (source === target) throw validationError("--from and --to name the same organization.");
  const typed = reason?.trim() ?? "";
  const why = typed === "" ? `Copy projects from ${source} into ${target}` : typed;
  if (why.length > 500) throw validationError("--reason is limited to 500 characters.");
  const named = (projects ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const requesterKey = requireRequesterKey();
  const endpoint = getEndpoint();
  const sides: Side[] = [
    {
      label: "source",
      organization: source,
      counterpartOrganization: target,
      scopes: ["copy:source"],
    },
    {
      label: "target",
      organization: target,
      counterpartOrganization: source,
      scopes: ["copy:target"],
    },
  ];
  const asked = [];
  for (const side of sides) {
    asked.push(await requestSide({ side, reason: why, requesterKey, endpoint }));
  }
  console.error(chalk.gray("Waiting for both approvals..."));
  const approved: Approved[] = [];
  try {
    for (const side of asked) {
      approved.push(await approveSide({ ...side, requesterKey, endpoint }));
    }
    const [sourceSession, targetSession] = approved as [Approved, Approved];
    const report = await staffAccessFetch<CopyReport>({
      method: "POST",
      path: "/api/staff-access/ops/copies",
      bearer: targetSession.opsToken,
      body: {
        sourceOpsToken: sourceSession.opsToken,
        ...(named.length > 0 ? { projects: named } : {}),
        ...(dryRun ? { dryRun: true } : {}),
      },
      endpoint,
    });
    return {
      data: report,
      table: () => printReport(report),
    };
  } finally {
    for (const side of approved) {
      await endSide({ requestId: side.requestId, requesterKey, endpoint });
    }
  }
};

const printReport = (report: CopyReport): void => {
  console.log(
    chalk.bold(
      `${report.dryRun ? "Dry run: " : ""}${sanitizeTerminalText(report.source.name)} -> ${sanitizeTerminalText(report.target.name)}`,
    ),
  );
  formatTable({
    data: report.items.map((item) => ({
      Kind: item.kind,
      Name: sanitizeTerminalText(item.name),
      Outcome: item.outcome,
      Reason: item.reason ? sanitizeTerminalText(item.reason) : "-",
    })),
    headers: ["Kind", "Name", "Outcome", "Reason"],
    colorMap: { Name: chalk.cyan },
    emptyMessage: "Nothing to copy.",
  });
  console.log(
    Object.entries(report.totals)
      .filter(([, count]) => count > 0)
      .map(([outcome, count]) => `${outcome}: ${count}`)
      .join(", ") || "Nothing to copy.",
  );
  if (report.stoppedBecause) {
    console.log(
      chalk.yellow(
        `Stopped early (${sanitizeTerminalText(report.stoppedBecause)}): an approval ended.`,
      ),
    );
  }
};

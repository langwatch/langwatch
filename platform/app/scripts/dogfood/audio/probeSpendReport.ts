/**
 * The audio spend probe's assertions and its printed table.
 *
 * Every wait is a poll to a deadline rather than a fixed sleep: the spend
 * pipeline's latency is a range, not a constant, and a sleep long enough to
 * be reliable is long enough to hide a regression in the tail.
 */

import {
  type LedgerDebit,
  type ProbeScope,
  readBudgetSpendNanoUsd,
  readLedgerDebits,
  readSpendRows,
  readTraceCostUsd,
  type SpendRow,
} from "./probeSpendReads";

/** 4000 characters at tts-1's $15 per million characters. */
export const EXPECTED_COST_NANO_USD = 60_000_000;
export const SPEECH_CHARS = 4000;
export const SPEECH_CALLS = 3;

/** One call the probe made, as the gateway identified it on the response. */
export interface Call {
  label: string;
  gatewayRequestId: string;
  traceId: string;
  httpStatus: number;
}

export function log(line: string): void {
  process.stderr.write(`[probe-audio-spend] ${line}\n`);
}

const failures: string[] = [];

export function failureCount(): number {
  return failures.length;
}

export function printFailures(): void {
  if (failures.length === 0) return;
  process.stdout.write(`\n${failures.length} check(s) failed:\n`);
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
}

function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures.push(`${name}: ${detail}`);
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}\n`);
}

/** Poll until the predicate holds or the deadline passes. */
async function until<T>(
  what: string,
  deadlineMs: number,
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  const stopAt = Date.now() + deadlineMs;
  let last = await read();
  while (!done(last)) {
    if (Date.now() > stopAt) {
      throw new Error(
        `timed out after ${deadlineMs}ms waiting for ${what}; last read: ` +
          JSON.stringify(last),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    last = await read();
  }
  log(`${what}: satisfied`);
  return last;
}

function printTable(rows: SpendRow[]): void {
  const header = [
    "REQUEST",
    "MODEL",
    "STATUS",
    "CHARS",
    "TOK IN",
    "TOK OUT",
    "COST nanoUSD",
  ];
  const body = rows.map((r) => [
    r.GatewayRequestId.slice(-12),
    r.Model,
    r.Status,
    r.CharsInput,
    r.TokensInput,
    r.TokensOutput,
    r.CostNanoUSD,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i]!.length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  process.stdout.write(`\n${line(header)}\n`);
  process.stdout.write(`${widths.map((w) => "-".repeat(w)).join("  ")}\n`);
  for (const row of body) process.stdout.write(`${line(row)}\n`);
  process.stdout.write("\n");
}

/** Every speech call carried its characters and priced at the catalog rate. */
function checkSpeechRows(speechRows: SpendRow[]): void {
  check(
    "three speech rows recorded",
    speechRows.length === SPEECH_CALLS,
    `${speechRows.length} of ${SPEECH_CALLS}`,
  );
  for (const row of speechRows) {
    const id = row.GatewayRequestId.slice(-12);
    check(
      `characters reached the record (${id})`,
      row.CharsInput === String(SPEECH_CHARS),
      `CharsInput=${row.CharsInput}`,
    );
    check(
      `speech call priced (${id})`,
      row.CostNanoUSD === String(EXPECTED_COST_NANO_USD),
      `CostNanoUSD=${row.CostNanoUSD}, want ${EXPECTED_COST_NANO_USD}`,
    );
  }
}

function checkLedger(debits: LedgerDebit[]): void {
  const successDebits = debits.filter((d) => d.Status === "success");
  check(
    "three speech debits landed as success",
    successDebits.filter(
      (d) => d.AmountNanoUSD === String(EXPECTED_COST_NANO_USD),
    ).length === SPEECH_CALLS,
    `${successDebits.length} success debits total`,
  );
}

/**
 * The claim the defect made false: the trace explorer and the budget state
 * the same cost for the same request.
 *
 * The trace id comes off the response, not the spend row: the row's TraceId
 * column is empty on these routes today, so joining through it would skip the
 * check. A missing join key fails rather than returning quietly, because this
 * is the probe's headline claim and a silent skip would print "All checks
 * passed" having proved nothing.
 */
async function checkTraceCost(
  scope: ProbeScope,
  speech: Call | undefined,
  row: SpendRow | undefined,
  deadlineMs: number,
): Promise<void> {
  if (!speech?.traceId || !row) {
    check(
      "trace cost equals the billed cost",
      false,
      speech?.traceId
        ? "no spend row for the first speech call"
        : "the response carried no trace id to join on",
    );
    return;
  }
  const traceCost = await until(
    "the trace explorer's cost for the speech call",
    deadlineMs,
    () => readTraceCostUsd(scope, speech.traceId),
    (c) => c !== null,
  );
  const billedUsd = Number(row.CostNanoUSD) / 1e9;
  check(
    "trace cost equals the billed cost",
    Math.abs((traceCost ?? 0) - billedUsd) < 1e-9,
    `trace=${traceCost}, billed=${billedUsd}`,
  );
}

export async function assertOutcome(
  scope: ProbeScope,
  calls: Call[],
  deadlineMs: number,
): Promise<void> {
  const speechCalls = calls.filter((c) => c.label.startsWith("speech"));
  const speechRequestIds = new Set(speechCalls.map((c) => c.gatewayRequestId));

  const rows = await until(
    "four priced spend rows",
    deadlineMs,
    () => readSpendRows(scope),
    (r) => r.length >= calls.length,
  );
  printTable(rows);

  const speechRows = rows.filter((r) =>
    speechRequestIds.has(r.GatewayRequestId),
  );
  checkSpeechRows(speechRows);

  const controlRow = rows.find(
    (r) => !speechRequestIds.has(r.GatewayRequestId),
  );
  const controlNano = Number(controlRow?.CostNanoUSD ?? 0);
  check(
    "control call still prices",
    controlNano > 0,
    `CostNanoUSD=${controlNano}`,
  );

  checkLedger(
    await until(
      "the ledger's debits",
      deadlineMs,
      () => readLedgerDebits(scope),
      (d) => d.length >= calls.length,
    ),
  );

  const expectedDelta = SPEECH_CALLS * EXPECTED_COST_NANO_USD + controlNano;
  const spent = await until(
    "the budget to reach the expected delta",
    deadlineMs,
    () => readBudgetSpendNanoUsd(scope),
    (s) => Math.abs(s - expectedDelta) <= expectedDelta * 0.01,
  );
  check(
    "budget moved by the calls' cost",
    Math.abs(spent - expectedDelta) <= expectedDelta * 0.01,
    `spent=${spent}, expected=${expectedDelta} (within 1%)`,
  );

  const firstSpeech = speechCalls[0];
  await checkTraceCost(
    scope,
    firstSpeech,
    rows.find((r) => r.GatewayRequestId === firstSpeech?.gatewayRequestId),
    deadlineMs,
  );
}

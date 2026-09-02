/**
 * The image spend probe's assertions and its printed table.
 *
 * The check registry, the poll helper and the table printer are module
 * private in the audio report, and its assertions are written against
 * characters and a fixed expected cost, so the three helpers are copied here
 * rather than imported. The reads are shared: see probeImageSpendReads.ts.
 *
 * Every wait is a poll to a deadline rather than a fixed sleep: the spend
 * pipeline's latency is a range, not a constant, and a sleep long enough to
 * be reliable is long enough to hide a regression in the tail.
 */

import {
  type ImageSpendRow,
  type LedgerDebit,
  type ProbeScope,
  readBudgetSpendNanoUsd,
  readImageSpendRows,
  readLedgerDebits,
  readTraceCostUsd,
  readTraceSpans,
} from "./probeImageSpendReads";

/**
 * The largest stored span output an image call may carry. A base64 image is
 * hundreds of kilobytes, so anything under a kilobyte proves the payload was
 * not written into the trace.
 */
export const MAX_SPAN_OUTPUT_BYTES = 1024;

/** One call the probe made, as the gateway identified it on the response. */
export interface Call {
  label: string;
  gatewayRequestId: string;
  traceId: string;
  httpStatus: number;
  /** The prompt this call sent, checked against the span's input. */
  prompt: string;
  /** The span name the trace explorer must carry for this call. */
  spanName: string;
}

export function log(line: string): void {
  process.stderr.write(`[probe-image-spend] ${line}\n`);
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

function printTable(rows: ImageSpendRow[], calls: Call[]): void {
  const labelOf = new Map(calls.map((c) => [c.gatewayRequestId, c.label]));
  const header = [
    "CALL",
    "REQUEST",
    "MODEL",
    "STATUS",
    "IMG IN TOK",
    "IMG OUT TOK",
    "IMAGES",
    "TOK IN",
    "TOK OUT",
    "COST nanoUSD",
  ];
  const body = rows.map((r) => [
    labelOf.get(r.GatewayRequestId) ?? "other",
    r.GatewayRequestId.slice(-12),
    r.Model,
    r.Status,
    String(r.inputImageTokens),
    String(r.outputImageTokens),
    String(r.imageCount),
    r.TokensInput,
    r.TokensOutput,
    r.CostNanoUSD,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i]?.length ?? 0)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
  process.stdout.write(`\n${line(header)}\n`);
  process.stdout.write(`${widths.map((w) => "-".repeat(w)).join("  ")}\n`);
  for (const row of body) process.stdout.write(`${line(row)}\n`);
  process.stdout.write("\n");
}

/**
 * Both calls carried image quantities to the record and rated above zero.
 *
 * The generation call has no input image, so only its output tokens must
 * move; the edit call sends a PNG, so both sides must.
 */
function checkSpendRows(calls: Call[], rows: ImageSpendRow[]): void {
  for (const call of calls) {
    const row = rows.find((r) => r.GatewayRequestId === call.gatewayRequestId);
    if (!row) {
      check(`spend row recorded (${call.label})`, false, "no row");
      continue;
    }
    const id = row.GatewayRequestId.slice(-12);
    check(`spend row recorded (${call.label})`, true, `request ${id}`);
    check(
      `output image tokens reached the record (${call.label})`,
      row.outputImageTokens > 0,
      `TokensOutputImage=${row.outputImageTokens}`,
    );
    if (call.label === "edit") {
      check(
        `input image tokens reached the record (${call.label})`,
        row.inputImageTokens > 0,
        `TokensInputImage=${row.inputImageTokens}`,
      );
    }
    check(
      `call priced above zero (${call.label})`,
      Number(row.CostNanoUSD) > 0,
      `CostNanoUSD=${row.CostNanoUSD}`,
    );
  }
}

function checkLedger(debits: LedgerDebit[], expectedCalls: number): void {
  const successDebits = debits.filter(
    (d) => d.Status === "success" && Number(d.AmountNanoUSD) > 0,
  );
  check(
    "both image calls debited the ledger",
    successDebits.length >= expectedCalls,
    `${successDebits.length} positive success debits, want ${expectedCalls}`,
  );
}

/**
 * The trace explorer states a cost for the call and carries a span for it
 * whose input holds the prompt and whose output holds no image payload.
 *
 * The trace id comes off the response, not the spend row: the row's TraceId
 * column is empty on these routes today, so joining through it would skip the
 * check. A missing join key fails rather than returning quietly, because a
 * silent skip would print "All checks passed" having proved nothing.
 */
async function checkTrace(
  scope: ProbeScope,
  call: Call,
  deadlineMs: number,
): Promise<void> {
  if (!call.traceId) {
    check(
      `trace recorded (${call.label})`,
      false,
      "the response carried no trace id to join on",
    );
    return;
  }
  const traceCost = await until(
    `the trace explorer's cost for ${call.label}`,
    deadlineMs,
    () => readTraceCostUsd(scope, call.traceId),
    (c) => c !== null && c > 0,
  );
  check(
    `trace cost above zero (${call.label})`,
    (traceCost ?? 0) > 0,
    `total_cost=${traceCost}`,
  );

  const spans = await until(
    `the ${call.spanName} span of ${call.label}`,
    deadlineMs,
    () => readTraceSpans(scope, call.traceId),
    (s) => s.some((span) => span.SpanName === call.spanName),
  );
  const span = spans.find((s) => s.SpanName === call.spanName);
  if (!span) {
    check(
      `span ${call.spanName} present (${call.label})`,
      false,
      `spans on this trace: ${spans.map((s) => s.SpanName).join(", ") || "none"}`,
    );
    return;
  }
  check(`span ${call.spanName} present (${call.label})`, true, "found");
  check(
    `span input carries the prompt (${call.label})`,
    span.input.includes(call.prompt),
    `input is ${span.input.length} bytes`,
  );
  const outputBytes = Buffer.byteLength(span.output, "utf8");
  check(
    `span output carries no image payload (${call.label})`,
    outputBytes < MAX_SPAN_OUTPUT_BYTES && !span.output.includes("b64_json"),
    `output is ${outputBytes} bytes, limit ${MAX_SPAN_OUTPUT_BYTES}`,
  );
}

export async function assertOutcome(
  scope: ProbeScope,
  calls: Call[],
  deadlineMs: number,
): Promise<void> {
  const requestIds = new Set(calls.map((c) => c.gatewayRequestId));

  const rows = await until(
    "a spend row for every image call",
    deadlineMs,
    () => readImageSpendRows(scope),
    (r) =>
      calls.every((c) =>
        r.some((row) => row.GatewayRequestId === c.gatewayRequestId),
      ),
  );
  printTable(
    rows.filter((r) => requestIds.has(r.GatewayRequestId)),
    calls,
  );
  checkSpendRows(calls, rows);

  checkLedger(
    await until(
      "the ledger's debits",
      deadlineMs,
      () => readLedgerDebits(scope),
      (d) =>
        d.filter((x) => x.Status === "success" && Number(x.AmountNanoUSD) > 0)
          .length >= calls.length,
    ),
    calls.length,
  );

  const spent = await until(
    "the budget to move",
    deadlineMs,
    () => readBudgetSpendNanoUsd(scope),
    (s) => s > 0,
  );
  check(
    "budget moved by a positive amount",
    spent > 0,
    `spent=${spent} nanoUSD (${spent / 1e9} USD)`,
  );

  for (const call of calls) {
    await checkTrace(scope, call, deadlineMs);
  }
}

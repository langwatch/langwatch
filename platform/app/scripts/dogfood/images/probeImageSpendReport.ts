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

/**
 * Images per call the probe asks for. Both calls send n=1, so a record that
 * counts fewer means the count was dropped between the gateway and the row.
 */
const EXPECTED_IMAGES_PER_CALL = 1;

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
  /**
   * Whether this call sent a source image, so its record must carry input
   * image tokens. Stated by the caller that made the request rather than
   * derived from the display label, which a rename would silently turn off.
   */
  hasSourceImage: boolean;
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

function check({
  name,
  isOk,
  detail,
}: {
  name: string;
  isOk: boolean;
  detail: string;
}): void {
  if (!isOk) failures.push(`${name}: ${detail}`);
  process.stdout.write(`${isOk ? "PASS" : "FAIL"}  ${name}  ${detail}\n`);
}

async function until<T>({
  what,
  deadlineMs,
  read,
  done,
}: {
  what: string;
  deadlineMs: number;
  read: () => Promise<T>;
  done: (value: T) => boolean;
}): Promise<T> {
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

function printTable({
  rows,
  calls,
}: {
  rows: ImageSpendRow[];
  calls: Call[];
}): void {
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
function checkSpendRows({
  calls,
  rows,
}: {
  calls: Call[];
  rows: ImageSpendRow[];
}): void {
  for (const call of calls) {
    const row = rows.find((r) => r.GatewayRequestId === call.gatewayRequestId);
    if (!row) {
      check({
        name: `spend row recorded (${call.label})`,
        isOk: false,
        detail: "no row",
      });
      continue;
    }
    const id = row.GatewayRequestId.slice(-12);
    check({
      name: `spend row recorded (${call.label})`,
      isOk: true,
      detail: `request ${id}`,
    });
    check({
      name: `output image tokens reached the record (${call.label})`,
      isOk: row.outputImageTokens > 0,
      detail: `TokensOutputImage=${row.outputImageTokens}`,
    });
    check({
      name: `image count reached the record (${call.label})`,
      isOk: row.imageCount >= EXPECTED_IMAGES_PER_CALL,
      detail: `ImageCount=${row.imageCount}, want at least ${EXPECTED_IMAGES_PER_CALL}`,
    });
    if (call.hasSourceImage) {
      check({
        name: `input image tokens reached the record (${call.label})`,
        isOk: row.inputImageTokens > 0,
        detail: `TokensInputImage=${row.inputImageTokens}`,
      });
    }
    check({
      name: `call priced above zero (${call.label})`,
      isOk: Number(row.CostNanoUSD) > 0,
      detail: `CostNanoUSD=${row.CostNanoUSD}`,
    });
  }
}

function checkLedger({
  debits,
  expectedCalls,
}: {
  debits: LedgerDebit[];
  expectedCalls: number;
}): void {
  const successDebits = debits.filter(
    (d) => d.Status === "success" && Number(d.AmountNanoUSD) > 0,
  );
  check({
    name: "both image calls debited the ledger",
    isOk: successDebits.length >= expectedCalls,
    detail: `${successDebits.length} positive success debits, want ${expectedCalls}`,
  });
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
async function checkTrace({
  scope,
  call,
  deadlineMs,
}: {
  scope: ProbeScope;
  call: Call;
  deadlineMs: number;
}): Promise<void> {
  if (!call.traceId) {
    check({
      name: `trace recorded (${call.label})`,
      isOk: false,
      detail: "the response carried no trace id to join on",
    });
    return;
  }
  const traceCost = await until({
    what: `the trace explorer's cost for ${call.label}`,
    deadlineMs,
    read: () => readTraceCostUsd(scope, call.traceId),
    done: (c) => c !== null && c > 0,
  });
  check({
    name: `trace cost above zero (${call.label})`,
    isOk: (traceCost ?? 0) > 0,
    detail: `total_cost=${traceCost}`,
  });

  const spans = await until({
    what: `the ${call.spanName} span of ${call.label}`,
    deadlineMs,
    read: () => readTraceSpans({ scope, traceId: call.traceId }),
    done: (s) => s.some((span) => span.SpanName === call.spanName),
  });
  const span = spans.find((s) => s.SpanName === call.spanName);
  if (!span) {
    check({
      name: `span ${call.spanName} present (${call.label})`,
      isOk: false,
      detail: `spans on this trace: ${spans.map((s) => s.SpanName).join(", ") || "none"}`,
    });
    return;
  }
  check({
    name: `span ${call.spanName} present (${call.label})`,
    isOk: true,
    detail: "found",
  });
  check({
    name: `span input carries the prompt (${call.label})`,
    isOk: span.input.includes(call.prompt),
    detail: `input is ${span.input.length} bytes`,
  });
  const outputBytes = Buffer.byteLength(span.output, "utf8");
  check({
    name: `span output carries no image payload (${call.label})`,
    isOk:
      outputBytes < MAX_SPAN_OUTPUT_BYTES && !span.output.includes("b64_json"),
    detail: `output is ${outputBytes} bytes, limit ${MAX_SPAN_OUTPUT_BYTES}`,
  });
}

export async function assertOutcome({
  scope,
  calls,
  deadlineMs,
}: {
  scope: ProbeScope;
  calls: Call[];
  deadlineMs: number;
}): Promise<void> {
  const requestIds = new Set(calls.map((c) => c.gatewayRequestId));

  const rows = await until({
    what: "a spend row for every image call",
    deadlineMs,
    read: () => readImageSpendRows(scope),
    done: (r) =>
      calls.every((c) =>
        r.some((row) => row.GatewayRequestId === c.gatewayRequestId),
      ),
  });
  printTable({
    rows: rows.filter((r) => requestIds.has(r.GatewayRequestId)),
    calls,
  });
  checkSpendRows({ calls, rows });

  checkLedger({
    debits: await until({
      what: "the ledger's debits",
      deadlineMs,
      read: () => readLedgerDebits(scope),
      done: (d) =>
        d.filter((x) => x.Status === "success" && Number(x.AmountNanoUSD) > 0)
          .length >= calls.length,
    }),
    expectedCalls: calls.length,
  });

  const spent = await until({
    what: "the budget to move",
    deadlineMs,
    read: () => readBudgetSpendNanoUsd(scope),
    done: (s) => s > 0,
  });
  check({
    name: "budget moved by a positive amount",
    isOk: spent > 0,
    detail: `spent=${spent} nanoUSD (${spent / 1e9} USD)`,
  });

  for (const call of calls) {
    await checkTrace({ scope, call, deadlineMs });
  }
}

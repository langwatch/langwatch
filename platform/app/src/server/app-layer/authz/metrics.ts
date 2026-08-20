import { Counter, register } from "prom-client";

// Remove existing metrics if they exist (for hot reload)
const metricNames = ["authz_ledger_write_gate_read_failures_total"] as const;

for (const name of metricNames) {
  register.removeSingleMetric(name);
}

/**
 * The write gate's migration-state read failed (`ledger-write-gate.ts`): for
 * up to the negative-cache TTL, this organization's grant writes route to the
 * legacy path regardless of its true migration status — the exact window
 * that produces the stranded rows `ledger.ts`'s `changeBindingRole` has to
 * adopt around. The failure already logs a structured warn; this counter is
 * what lets an outage that reopens the window page rather than sit unread in
 * the log stream.
 */
export const authzLedgerWriteGateReadFailuresTotal = new Counter({
  name: "authz_ledger_write_gate_read_failures_total",
  help: "Failed reads of an organization's genesis-import migration state; writes fall back to the legacy path for the negative-cache TTL.",
});

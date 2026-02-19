import { Counter, Gauge, register } from "prom-client";

// Remove existing metrics if they exist (for hot reload)
const metricNames = [
  "gq_active_groups",
  "gq_pending_groups",
  "gq_groups_blocked_total",
  "gq_jobs_staged_total",
  "gq_jobs_dispatched_total",
  "gq_jobs_completed_total",
  "gq_jobs_deduped_total",
] as const;

for (const name of metricNames) {
  register.removeSingleMetric(name);
}

export const gqActiveGroups = new Gauge({
  name: "gq_active_groups",
  help: "Number of groups currently being processed",
  labelNames: ["queue_name"] as const,
});

export const gqPendingGroups = new Gauge({
  name: "gq_pending_groups",
  help: "Number of groups with pending jobs waiting to be dispatched",
  labelNames: ["queue_name"] as const,
});

export const gqGroupsBlockedTotal = new Counter({
  name: "gq_groups_blocked_total",
  help: "Total number of groups that have been blocked due to exhausted retries",
  labelNames: ["queue_name"] as const,
});

export const gqJobsStagedTotal = new Counter({
  name: "gq_jobs_staged_total",
  help: "Total number of jobs staged into the group queue",
  labelNames: ["queue_name"] as const,
});

export const gqJobsDispatchedTotal = new Counter({
  name: "gq_jobs_dispatched_total",
  help: "Total number of jobs dispatched from staging to BullMQ",
  labelNames: ["queue_name"] as const,
});

export const gqJobsCompletedTotal = new Counter({
  name: "gq_jobs_completed_total",
  help: "Total number of jobs completed successfully",
  labelNames: ["queue_name"] as const,
});

export const gqJobsDedupedTotal = new Counter({
  name: "gq_jobs_deduped_total",
  help: "Total number of jobs that were deduplicated (replaced existing staged job)",
  labelNames: ["queue_name"] as const,
});

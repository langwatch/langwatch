import SwiftUI

/// The calendar scheduler, read-only.
///
/// Schedules that are struggling — a rising attempt count with a last error —
/// sort to the top, because a schedule that quietly stopped firing is exactly
/// the failure nobody notices until a customer does.
struct SchedulerView: View {
    @StateObject private var loader: Loader<[ScheduledJob]>
    @State private var showStrugglingOnly = false

    init(client: OpsClient) {
        _loader = StateObject(wrappedValue: Loader { try await client.scheduledJobs() })
    }

    var body: some View {
        List {
            Section {
                Toggle("Struggling only", isOn: $showStrugglingOnly)
                    .font(.subheadline)
            }

            Section {
                LoadableView(state: loader.state, retry: { loader.reload() }) { jobs in
                    let visible = filtered(jobs)
                    if visible.isEmpty {
                        EmptyStateRow(
                            message: showStrugglingOnly
                                ? "No schedule is failing."
                                : "Nothing is scheduled."
                        )
                    } else {
                        ForEach(visible) { job in
                            NavigationLink {
                                ScheduledJobDetailView(job: job)
                            } label: {
                                ScheduledJobRow(job: job)
                            }
                        }
                    }
                }
            } header: {
                Text("Schedules")
            } footer: {
                Text("Firing, pausing and editing a schedule all happen in the web console.")
            }
        }
        .navigationTitle("Scheduler")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await loader.refresh() }
        .task { loader.loadIfNeeded() }
    }

    private func filtered(_ jobs: [ScheduledJob]) -> [ScheduledJob] {
        let candidates = showStrugglingOnly ? jobs.filter(\.isStruggling) : jobs
        return candidates.sorted { left, right in
            if left.isStruggling != right.isStruggling { return left.isStruggling }
            if left.active != right.active { return left.active }
            return left.nextRunAt < right.nextRunAt
        }
    }
}

private struct ScheduledJobRow: View {
    let job: ScheduledJob

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(job.targetType)
                    .font(.subheadline.weight(.medium))
                Spacer(minLength: 8)
                if job.isStruggling {
                    StatusPill(text: "\(job.attempts) attempts", severity: .critical)
                } else if !job.active {
                    StatusPill(text: "inactive", severity: .warning)
                } else if job.currentSlot != nil {
                    StatusPill(text: "running")
                }
            }
            Text("\(job.cron) · \(job.timezone)")
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            Text("Next \(Format.shortDateTime(fromISO: job.nextRunAt))")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let error = job.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }
}

struct ScheduledJobDetailView: View {
    let job: ScheduledJob

    var body: some View {
        List {
            Section("Schedule") {
                DetailRow(label: "Cron", value: job.cron, isMonospaced: true)
                DetailRow(label: "Timezone", value: job.timezone)
                DetailRow(label: "Active", value: job.active ? "Yes" : "No")
                DetailRow(label: "Next run", value: Format.shortDateTime(fromISO: job.nextRunAt))
                if let last = job.lastSlot {
                    DetailRow(label: "Last slot", value: Format.shortDateTime(fromISO: last))
                }
            }

            Section {
                DetailRow(label: "Target", value: job.targetType)
                DetailRow(label: "Target id", value: job.targetId, isMonospaced: true)
                DetailRow(label: "Project", value: job.projectId, isMonospaced: true)
            } header: {
                Text("What it runs")
            }

            Section {
                if let slot = job.currentSlot {
                    DetailRow(label: "Working slot", value: Format.shortDateTime(fromISO: slot))
                } else {
                    DetailRow(label: "Working slot", value: "idle")
                }
                DetailRow(label: "Attempts", value: String(job.attempts))
            } header: {
                Text("Right now")
            } footer: {
                Text("A claimed slot with a rising attempt count is a job failing and retrying, not one running long — the scheduler records no lease holder.")
            }

            if let error = job.lastError {
                Section("Last error") {
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }
            }
        }
        .navigationTitle("Schedule")
        .navigationBarTitleDisplayMode(.inline)
    }
}

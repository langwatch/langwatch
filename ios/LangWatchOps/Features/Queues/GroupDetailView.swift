import SwiftUI

/// One group: why it is stuck, and what is waiting behind it.
struct GroupDetailView: View {
    private let queueName: String
    private let group: QueueGroup
    @StateObject private var jobs: Loader<JobsPage>

    init(client: OpsClient, queueName: String, group: QueueGroup) {
        self.queueName = queueName
        self.group = group
        let groupId = group.groupId
        _jobs = StateObject(
            wrappedValue: Loader {
                try await client.groupJobs(queueName: queueName, groupId: groupId)
            }
        )
    }

    var body: some View {
        List {
            Section("Group") {
                DetailRow(label: "Id", value: group.groupId, isMonospaced: true)
                DetailRow(label: "Queue", value: queueName, isMonospaced: true)
                if let pipeline = group.pipelineName {
                    DetailRow(label: "Pipeline", value: pipeline, isMonospaced: true)
                }
                if let jobName = group.jobName {
                    DetailRow(label: "Job", value: jobName, isMonospaced: true)
                }
                if let jobType = group.jobType {
                    DetailRow(label: "Type", value: jobType)
                }
                DetailRow(label: "Pending jobs", value: Format.count(group.pendingJobs))
            }

            Section("State") {
                DetailRow(label: "Blocked", value: group.isBlocked ? "Yes" : "No")
                if group.isStaleBlock {
                    Label("Stale block — nothing is retrying this any more.", systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
                if let retries = group.retryCount {
                    DetailRow(label: "Retries", value: String(retries))
                }
                if group.hasActiveJob, let activeJobId = group.activeJobId {
                    DetailRow(label: "Active job", value: activeJobId, isMonospaced: true)
                }
                if let ttl = group.activeKeyTtlSec {
                    DetailRow(label: "Lock expires in", value: Format.duration(seconds: ttl))
                }
                if let duration = group.processingDurationMs {
                    DetailRow(label: "Processing for", value: Format.milliseconds(duration))
                }
                if let oldest = group.oldestJobMs {
                    DetailRow(
                        label: "Oldest job",
                        value: Format.relative(Date(timeIntervalSince1970: oldest / 1000))
                    )
                }
            }

            if let error = group.errorMessage {
                Section {
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                    if let timestamp = group.errorTimestamp {
                        DetailRow(
                            label: "Failed",
                            value: Format.relative(Date(timeIntervalSince1970: timestamp / 1000))
                        )
                    }
                } header: {
                    Text("Error")
                }

                if let stack = group.errorStack {
                    Section("Stack") {
                        Text(stack)
                            .font(.caption2.monospaced())
                            .textSelection(.enabled)
                    }
                }
            }

            Section {
                LoadableView(state: jobs.state, retry: { jobs.reload() }) { page in
                    if page.jobs.isEmpty {
                        EmptyStateRow(message: "No jobs are queued in this group.")
                    } else {
                        ForEach(page.jobs) { job in
                            JobRow(job: job)
                        }
                    }
                }
            } header: {
                Text("Queued jobs")
            } footer: {
                Text("Job payloads stay on the server. This lists what each job carries and how big it is, never its contents.")
            }
        }
        .navigationTitle("Group")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await jobs.refresh() }
        .task { jobs.loadIfNeeded() }
    }
}

private struct JobRow: View {
    let job: JobSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(job.jobId)
                    .font(.caption.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                Text(Format.bytes(job.payloadBytes))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            if !job.payloadKeys.isEmpty {
                Text(job.payloadKeys.joined(separator: ", "))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }
}

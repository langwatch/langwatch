import SwiftUI

/// What is broken, in one place: dead letters, clustered errors, tenant
/// anomalies.
///
/// These live on three separate web pages, but on a phone they are the same
/// question — "is anything on fire" — so they share a screen and a pull to
/// refresh.
struct HealthView: View {
    @StateObject private var deadLetters: Loader<[DlqGroup]>
    @StateObject private var blocked: Loader<BlockedSummary>
    @StateObject private var anomalies: Loader<[Anomaly]>

    init(client: OpsClient) {
        _deadLetters = StateObject(wrappedValue: Loader { try await client.deadLetterGroups() })
        _blocked = StateObject(wrappedValue: Loader { try await client.blockedSummary() })
        _anomalies = StateObject(wrappedValue: Loader { try await client.anomalies() })
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LoadableView(state: anomalies.state, retry: { anomalies.reload() }) { list in
                        if list.isEmpty {
                            EmptyStateRow(message: "No tenant anomalies are active.")
                        } else {
                            ForEach(list) { anomaly in
                                NavigationLink {
                                    AnomalyDetailView(anomaly: anomaly)
                                } label: {
                                    AnomalyRow(anomaly: anomaly)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Anomalies")
                } footer: {
                    Text("Hard-tier first. Dismissing an anomaly happens in the web console.")
                }

                Section {
                    LoadableView(state: deadLetters.state, retry: { deadLetters.reload() }) { groups in
                        if groups.isEmpty {
                            EmptyStateRow(message: "Nothing has been dead-lettered.")
                        } else {
                            ForEach(groups.prefix(50)) { group in
                                NavigationLink {
                                    DeadLetterDetailView(group: group)
                                } label: {
                                    DeadLetterRow(group: group)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Dead letters")
                } footer: {
                    deadLetterFooter
                }

                Section {
                    LoadableView(state: blocked.state, retry: { blocked.reload() }) { summary in
                        if summary.clusters.isEmpty {
                            EmptyStateRow(message: "Nothing is blocked.")
                        } else {
                            ForEach(summary.clusters.prefix(20)) { cluster in
                                NavigationLink {
                                    ErrorClusterDetailView(cluster: cluster)
                                } label: {
                                    ErrorClusterRow(cluster: cluster)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Blocked by error")
                } footer: {
                    if let summary = blocked.state.value, summary.totalBlocked > 0 {
                        Text("\(Format.count(summary.totalBlocked)) blocked groups across \(summary.clusters.count) distinct errors.")
                    }
                }
            }
            .navigationTitle("Health")
            .refreshable {
                await anomalies.refresh()
                await deadLetters.refresh()
                await blocked.refresh()
            }
            .task {
                anomalies.loadIfNeeded()
                deadLetters.loadIfNeeded()
                blocked.loadIfNeeded()
            }
        }
    }

    @ViewBuilder
    private var deadLetterFooter: some View {
        if let groups = deadLetters.state.value, groups.count > 50 {
            Text("Showing the 50 most recent of \(Format.count(groups.count)).")
        }
    }
}

private struct AnomalyRow: View {
    let anomaly: Anomaly

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(anomaly.tenantId)
                    .font(.subheadline.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                StatusPill(
                    text: anomaly.tier,
                    severity: anomaly.isHardTier ? .critical : .warning
                )
            }
            Text(rateSummary)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var rateSummary: String {
        var text = "\(Format.rate(anomaly.currentRate))/s against a \(Format.rate(anomaly.baseline))/s baseline"
        if let multiple = anomaly.multipleOfBaseline {
            text += String(format: " (%.1f×)", multiple)
        }
        return "\(text) · \(Format.relative(anomaly.triggeredAtDate))"
    }
}

struct AnomalyDetailView: View {
    let anomaly: Anomaly

    /// A dictionary cannot be walked by `ForEach` directly — a key path to a
    /// tuple element is not expressible — so the contributors become rows with
    /// their own identity, biggest first.
    private struct Contributor: Identifiable {
        let name: String
        let rate: Double
        var id: String { name }
    }

    private var contributors: [Contributor] {
        (anomaly.contributors ?? [:])
            .map { Contributor(name: $0.key, rate: $0.value) }
            .sorted { $0.rate > $1.rate }
    }

    var body: some View {
        List {
            Section("Tenant") {
                DetailRow(label: "Project", value: anomaly.tenantId, isMonospaced: true)
                DetailRow(label: "Kind", value: anomaly.kind)
                DetailRow(label: "Tier", value: anomaly.tier)
                DetailRow(label: "Triggered", value: Format.shortDateTime(anomaly.triggeredAtDate))
            }

            Section("Rate") {
                DetailRow(label: "Current", value: "\(Format.rate(anomaly.currentRate))/s")
                DetailRow(label: "Baseline", value: "\(Format.rate(anomaly.baseline))/s")
                if let multiple = anomaly.multipleOfBaseline {
                    DetailRow(label: "Multiple", value: String(format: "%.1f×", multiple))
                }
            }

            Section("Why") {
                Text(anomaly.reason)
                    .font(.callout)
                    .textSelection(.enabled)
            }

            if !contributors.isEmpty {
                Section("Contributors") {
                    ForEach(contributors) { contributor in
                        DetailRow(label: contributor.name, value: Format.rate(contributor.rate))
                    }
                }
            }
        }
        .navigationTitle("Anomaly")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct DeadLetterRow: View {
    let group: DlqGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(group.groupId)
                    .font(.subheadline.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                Text("\(Format.count(group.jobCount)) jobs")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            if let error = group.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var subtitle: String {
        var parts = [group.queueDisplayName]
        if let pipeline = group.pipelineName { parts.append(pipeline) }
        if let moved = group.movedAtDate { parts.append(Format.relative(moved)) }
        return parts.joined(separator: " · ")
    }
}

struct DeadLetterDetailView: View {
    let group: DlqGroup

    var body: some View {
        List {
            Section("Group") {
                DetailRow(label: "Id", value: group.groupId, isMonospaced: true)
                DetailRow(label: "Queue", value: group.queueDisplayName)
                if let pipeline = group.pipelineName {
                    DetailRow(label: "Pipeline", value: pipeline, isMonospaced: true)
                }
                DetailRow(label: "Jobs", value: Format.count(group.jobCount))
                if let moved = group.movedAtDate {
                    DetailRow(label: "Dead-lettered", value: Format.shortDateTime(moved))
                }
            }

            if let error = group.error {
                Section("Error") {
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }
            }

            if let stack = group.errorStack {
                Section("Stack") {
                    Text(stack)
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                }
            }

            Section {
                Text("Replaying from the dead letter queue happens in the web console.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Dead letter")
        .navigationBarTitleDisplayMode(.inline)
    }
}

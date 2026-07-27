import Charts
import SwiftUI

/// The stats screen.
///
/// Ordered by what an operator opening their phone at 2am needs first: what is
/// wrong (blocked, dead-lettered, drifting), then how fast work is moving, then
/// how much room the machine has left. Throughput before Redis, because a queue
/// that has stopped moving is a page and a Redis at 60% is not.
struct DashboardView: View {
    @StateObject private var loader: Loader<DashboardResponse>
    @Environment(\.scenePhase) private var scenePhase

    /// Matches the server's own collection cadence. Faster would show the same
    /// numbers back; slower would let an incident sit unseen.
    private static let refreshInterval: TimeInterval = 10

    init(client: OpsClient) {
        _loader = StateObject(wrappedValue: Loader { try await client.dashboard() })
    }

    var body: some View {
        NavigationStack {
            List {
                LoadableView(state: loader.state, retry: { loader.reload() }) { response in
                    content(response)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Overview")
            .refreshable { await loader.refresh() }
            .task { loader.loadIfNeeded() }
            .task(id: scenePhase) { await pollWhileVisible() }
        }
    }

    /// Poll only while the app is in front. A dashboard that keeps hitting the
    /// instance from a backgrounded phone is a battery drain and a pointless
    /// load on the very thing being monitored.
    private func pollWhileVisible() async {
        guard scenePhase == .active else { return }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(Self.refreshInterval * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await loader.refresh()
        }
    }

    @ViewBuilder
    private func content(_ response: DashboardResponse) -> some View {
        let snapshot = response.snapshot

        if !response.hasSnapshot {
            Section {
                Label(
                    "Waiting for the first collection cycle — these figures are not live yet.",
                    systemImage: "hourglass"
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }

        Section {
            StatGrid {
                StatTile(
                    title: "Blocked groups",
                    value: Format.count(snapshot.blockedGroups),
                    caption: "of \(Format.count(snapshot.totalGroups)) groups",
                    severity: snapshot.blockedGroups > 0 ? .critical : .normal
                )
                StatTile(
                    title: "Pending jobs",
                    value: Format.count(snapshot.totalPendingJobs),
                    caption: driftCaption(snapshot.pendingDrift),
                    severity: snapshot.pendingDrift != 0 ? .warning : .normal
                )
                StatTile(
                    title: "Parked groups",
                    value: Format.count(snapshot.parkedGroups),
                    caption: "held by a tenant cap",
                    severity: snapshot.parkedGroups > 0 ? .warning : .normal
                )
                StatTile(
                    title: "Failing",
                    value: "\(Format.rate(snapshot.failedPerSec))/s",
                    caption: "peak \(Format.rate(snapshot.peakFailedPerSec))/s",
                    severity: snapshot.failedPerSec > 0 ? .critical : .normal
                )
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)

            StaleDataBanner(lastLoadedAt: loader.lastLoadedAt, failure: loader.refreshFailure)
        } header: {
            Text("Right now")
        }

        Section("Throughput") {
            if snapshot.throughputHistory.isEmpty {
                EmptyStateRow(message: "No history collected yet.")
            } else {
                ThroughputChart(points: snapshot.throughputHistory)
                    .frame(height: 180)
                    .listRowInsets(EdgeInsets(top: 12, leading: 8, bottom: 12, trailing: 12))
            }

            StatGrid {
                StatTile(
                    title: "Ingested",
                    value: "\(Format.rate(snapshot.throughputIngestedPerSec))/s",
                    caption: "peak \(Format.rate(snapshot.peakIngestedPerSec))/s"
                )
                StatTile(
                    title: "Completed",
                    value: "\(Format.rate(snapshot.completedPerSec))/s",
                    caption: "peak \(Format.rate(snapshot.peakCompletedPerSec))/s"
                )
                StatTile(
                    title: "Latency p50",
                    value: Format.milliseconds(snapshot.latencyP50Ms),
                    caption: "peak \(Format.milliseconds(snapshot.peakLatencyP50Ms))"
                )
                StatTile(
                    title: "Latency p99",
                    value: Format.milliseconds(snapshot.latencyP99Ms),
                    caption: "peak \(Format.milliseconds(snapshot.peakLatencyP99Ms))"
                )
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }

        Section("Phases") {
            PhaseRow(name: "Commands", metrics: snapshot.phases.commands)
            PhaseRow(name: "Projections", metrics: snapshot.phases.projections)
            PhaseRow(name: "Reactions", metrics: snapshot.phases.reactions)
        }

        Section("Redis") {
            StatGrid {
                StatTile(
                    title: "Memory",
                    value: Format.bytes(snapshot.redisMemoryUsedBytes),
                    caption: memoryCaption(snapshot),
                    severity: memorySeverity(snapshot)
                )
                StatTile(
                    title: "Engine CPU",
                    value: snapshot.redisEngineCpuPercent.map { Format.percent($0) } ?? "—",
                    caption: snapshot.redisEngineCpuPercent == nil ? "needs two samples" : nil,
                    severity: (snapshot.redisEngineCpuPercent ?? 0) > 80 ? .critical : .normal
                )
                StatTile(
                    title: "Clients",
                    value: Format.count(snapshot.redisConnectedClients)
                )
                StatTile(
                    title: "Peak memory",
                    value: Format.bytes(snapshot.redisMemoryPeakBytes)
                )
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }

        Section("This process") {
            DetailRow(label: "CPU", value: Format.percent(snapshot.processCpuPercent))
            DetailRow(
                label: "Memory",
                value: "\(snapshot.processMemoryUsedMb) MB of \(snapshot.processMemoryTotalMb) MB"
            )
        }

        if !snapshot.pausedKeys.isEmpty {
            Section {
                ForEach(snapshot.pausedKeys, id: \.self) { key in
                    Text(key).font(.footnote.monospaced())
                }
            } header: {
                Text("Paused pipelines")
            } footer: {
                Text("Paused from the web console. This app shows them but cannot change them.")
            }
        }

        if !snapshot.topErrors.isEmpty {
            Section("Top errors") {
                ForEach(snapshot.topErrors.prefix(5)) { cluster in
                    NavigationLink {
                        ErrorClusterDetailView(cluster: cluster)
                    } label: {
                        ErrorClusterRow(cluster: cluster)
                    }
                }
            }
        }
    }

    private func driftCaption(_ drift: Int) -> String {
        drift == 0 ? "counter matches" : "counter off by \(Format.count(drift))"
    }

    private func memoryCaption(_ snapshot: DashboardSnapshot) -> String? {
        guard snapshot.redisMemoryMaxBytes > 0 else { return "no limit set" }
        let ratio = Double(snapshot.redisMemoryUsedBytes) / Double(snapshot.redisMemoryMaxBytes)
        return "\(Format.percent(ratio * 100)) of \(Format.bytes(snapshot.redisMemoryMaxBytes))"
    }

    private func memorySeverity(_ snapshot: DashboardSnapshot) -> StatSeverity {
        guard snapshot.redisMemoryMaxBytes > 0 else { return .normal }
        let ratio = Double(snapshot.redisMemoryUsedBytes) / Double(snapshot.redisMemoryMaxBytes)
        if ratio >= 0.9 { return .critical }
        if ratio >= 0.75 { return .warning }
        return .normal
    }
}

private struct PhaseRow: View {
    let name: String
    let metrics: PhaseMetrics

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(name).font(.subheadline.weight(.medium))
                Spacer()
                if metrics.failedPerSec > 0 {
                    StatusPill(text: "\(Format.rate(metrics.failedPerSec))/s failing", severity: .critical)
                }
            }
            Text(
                "\(Format.count(metrics.pending)) pending · \(Format.count(metrics.active)) active · "
                    + "\(Format.rate(metrics.completedPerSec))/s done · p99 \(Format.milliseconds(metrics.latencyP99Ms))"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}

private struct ThroughputChart: View {
    let points: [ThroughputPoint]

    var body: some View {
        Chart {
            ForEach(points) { point in
                LineMark(
                    x: .value("Time", point.date),
                    y: .value("Per second", point.ingestedPerSec),
                    series: .value("Series", "Ingested")
                )
                .foregroundStyle(by: .value("Series", "Ingested"))

                LineMark(
                    x: .value("Time", point.date),
                    y: .value("Per second", point.completedPerSec),
                    series: .value("Series", "Completed")
                )
                .foregroundStyle(by: .value("Series", "Completed"))

                LineMark(
                    x: .value("Time", point.date),
                    y: .value("Per second", point.failedPerSec),
                    series: .value("Series", "Failed")
                )
                .foregroundStyle(by: .value("Series", "Failed"))
            }
        }
        .chartForegroundStyleScale([
            "Ingested": Color.accentColor,
            "Completed": Color.green,
            "Failed": Color.red,
        ])
        .chartLegend(position: .bottom, spacing: 8)
        .chartYAxis {
            AxisMarks(position: .leading)
        }
    }
}

struct ErrorClusterRow: View {
    let cluster: ErrorCluster

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(cluster.sampleMessage)
                    .font(.subheadline)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(Format.count(cluster.count))
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.red)
            }
            Text([cluster.pipelineName, cluster.queueName].compactMap { $0 }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

struct ErrorClusterDetailView: View {
    let cluster: ErrorCluster

    var body: some View {
        List {
            Section("Error") {
                Text(cluster.sampleMessage)
                    .font(.callout)
                    .textSelection(.enabled)
            }

            Section("Where") {
                DetailRow(label: "Queue", value: cluster.queueName, isMonospaced: true)
                if let pipeline = cluster.pipelineName {
                    DetailRow(label: "Pipeline", value: pipeline, isMonospaced: true)
                }
                DetailRow(label: "Occurrences", value: Format.count(cluster.count))
            }

            if !cluster.sampleGroupIds.isEmpty {
                Section {
                    ForEach(cluster.sampleGroupIds, id: \.self) { groupId in
                        Text(groupId)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                    }
                } header: {
                    Text("Sample groups")
                } footer: {
                    Text("A sample, not the full set — the cluster covers \(Format.count(cluster.count)) occurrences.")
                }
            }

            if let stack = cluster.sampleStack {
                Section("Stack") {
                    Text(stack)
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                }
            }
        }
        .navigationTitle("Error")
        .navigationBarTitleDisplayMode(.inline)
    }
}

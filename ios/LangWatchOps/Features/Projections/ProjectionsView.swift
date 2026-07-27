import SwiftUI

/// Projection replay, viewable and never startable.
///
/// A replay rebuilds projections across the fleet and takes the single replay
/// lock while it runs. Starting one is a decision made with the event log open
/// in front of you, so this screen shows what is registered, what is running and
/// what has run — and offers no control that begins or cancels anything.
struct ProjectionsView: View {
    @StateObject private var status: Loader<ReplayStatus>
    @StateObject private var history: Loader<[ReplayRun]>
    @StateObject private var catalog: Loader<ProjectionCatalog>

    init(client: OpsClient) {
        _status = StateObject(wrappedValue: Loader { try await client.replayStatus() })
        _history = StateObject(wrappedValue: Loader { try await client.replayHistory() })
        _catalog = StateObject(wrappedValue: Loader { try await client.projections() })
    }

    var body: some View {
        List {
            if let running = status.state.value, running.isRunning {
                Section("Running now") {
                    RunningReplayView(status: running)
                }
            }

            Section {
                LoadableView(state: history.state, retry: { history.reload() }) { runs in
                    if runs.isEmpty {
                        EmptyStateRow(message: "No replay has been run.")
                    } else {
                        ForEach(runs.prefix(20)) { run in
                            NavigationLink {
                                ReplayRunDetailView(run: run)
                            } label: {
                                ReplayRunRow(run: run)
                            }
                        }
                    }
                }
            } header: {
                Text("History")
            } footer: {
                Text("Starting and cancelling a replay happen in the web console.")
            }

            Section {
                LoadableView(state: catalog.state, retry: { catalog.reload() }) { registry in
                    NavigationLink {
                        ProjectionCatalogView(catalog: registry)
                    } label: {
                        Label(
                            "\(registry.projections.count) projections, \(registry.eventSubscribers.count) subscribers",
                            systemImage: "list.bullet.rectangle"
                        )
                    }
                }
            } header: {
                Text("Registered")
            }
        }
        .navigationTitle("Projection replay")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await status.refresh()
            await history.refresh()
            await catalog.refresh()
        }
        .task {
            status.loadIfNeeded()
            history.loadIfNeeded()
            catalog.loadIfNeeded()
        }
    }
}

private struct RunningReplayView: View {
    let status: ReplayStatus

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let progress = status.progress {
                ProgressView(value: progress)
                Text("\(Format.count(status.aggregatesProcessed)) of \(Format.count(status.aggregatesTotal)) aggregates")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ProgressView()
                Text("\(Format.count(status.aggregatesProcessed)) aggregates so far — total not yet known")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let projection = status.currentProjection {
                DetailRow(label: "Projection", value: projection, isMonospaced: true)
            }
            if let phase = status.currentPhase {
                DetailRow(label: "Phase", value: phase)
            }
            DetailRow(label: "Events", value: Format.count(status.eventsProcessed))
            if let description = status.description, !description.isEmpty {
                DetailRow(label: "Why", value: description)
            }
            if let userName = status.userName {
                DetailRow(label: "Started by", value: userName)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct ReplayRunRow: View {
    let run: ReplayRun

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(run.description.isEmpty ? run.runId : run.description)
                    .font(.subheadline)
                    .lineLimit(1)
                Spacer(minLength: 8)
                StatusPill(text: run.state, severity: severity)
            }
            Text("\(run.userName) · \(Format.shortDateTime(fromISO: run.startedAt))")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("\(Format.count(run.aggregatesProcessed)) aggregates · \(Format.count(run.eventsProcessed)) events")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var severity: StatSeverity {
        switch run.state {
        case "failed": return .critical
        case "cancelled": return .warning
        default: return .normal
        }
    }
}

struct ReplayRunDetailView: View {
    let run: ReplayRun

    var body: some View {
        List {
            Section("Run") {
                DetailRow(label: "Id", value: run.runId, isMonospaced: true)
                DetailRow(label: "State", value: run.state)
                DetailRow(label: "Started by", value: run.userName)
                DetailRow(label: "Started", value: Format.shortDateTime(fromISO: run.startedAt))
                if let completed = run.completedAt {
                    DetailRow(label: "Finished", value: Format.shortDateTime(fromISO: completed))
                }
            }

            if !run.description.isEmpty {
                Section("Why") {
                    Text(run.description).font(.callout)
                }
            }

            Section("Covered") {
                DetailRow(label: "Since", value: run.since)
                ForEach(run.projectionNames, id: \.self) { name in
                    Text(name).font(.caption.monospaced())
                }
                if run.tenantIds.isEmpty {
                    DetailRow(label: "Tenants", value: "all")
                } else {
                    DetailRow(label: "Tenants", value: String(run.tenantIds.count))
                }
            }

            Section("Work") {
                DetailRow(label: "Aggregates", value: Format.count(run.aggregatesProcessed))
                DetailRow(label: "Events", value: Format.count(run.eventsProcessed))
            }

            if let error = run.error {
                Section("Error") {
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }
            }
        }
        .navigationTitle("Replay")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct ProjectionCatalogView: View {
    let catalog: ProjectionCatalog

    var body: some View {
        List {
            Section("Projections") {
                ForEach(catalog.projections) { projection in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(projection.projectionName)
                                .font(.subheadline.monospaced())
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer(minLength: 8)
                            StatusPill(text: projection.kind)
                        }
                        Text("\(projection.pipelineName) · \(projection.aggregateType)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section("Event subscribers") {
                ForEach(catalog.eventSubscribers) { subscriber in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(subscriber.subscriberName)
                            .font(.subheadline.monospaced())
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Text("\(subscriber.pipelineName) · \(subscriber.aggregateType)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(subscriber.eventTypes.joined(separator: ", "))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                }
            }
        }
        .navigationTitle("Registered")
        .navigationBarTitleDisplayMode(.inline)
    }
}

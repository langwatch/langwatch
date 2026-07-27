import SwiftUI

/// One queue: its groups, and the pauses currently applied to it.
///
/// Blocked groups float to the top of the list. Everything on this screen is
/// read-only — unblocking, draining and redriving stay on the web console, where
/// the operator has the room to see what they are about to do.
struct QueueDetailView: View {
    private let client: OpsClient
    private let queue: QueueSummary

    @StateObject private var groups: Loader<GroupsPage>
    @StateObject private var pausedKeys: Loader<[String]>
    @StateObject private var pausedTenants: Loader<[String]>

    @State private var showBlockedOnly = false

    init(client: OpsClient, queue: QueueSummary) {
        self.client = client
        self.queue = queue
        let name = queue.name
        _groups = StateObject(wrappedValue: Loader { try await client.groups(queueName: name) })
        _pausedKeys = StateObject(wrappedValue: Loader { try await client.pausedKeys(queueName: name) })
        _pausedTenants = StateObject(wrappedValue: Loader { try await client.pausedTenants(queueName: name) })
    }

    var body: some View {
        List {
            Section {
                StatGrid {
                    StatTile(
                        title: "Blocked",
                        value: Format.count(queue.blockedGroupCount),
                        severity: queue.blockedGroupCount > 0 ? .critical : .normal
                    )
                    StatTile(title: "Pending groups", value: Format.count(queue.pendingGroupCount))
                    StatTile(title: "Active", value: Format.count(queue.activeGroupCount))
                    StatTile(
                        title: "Parked",
                        value: Format.count(queue.parkedGroupCount),
                        caption: "at a tenant cap",
                        severity: queue.parkedGroupCount > 0 ? .warning : .normal
                    )
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }

            Section {
                Toggle("Blocked only", isOn: $showBlockedOnly)
                    .font(.subheadline)
            }

            Section {
                LoadableView(state: groups.state, retry: { groups.reload() }) { page in
                    let visible = filtered(page.groups)
                    if visible.isEmpty {
                        EmptyStateRow(
                            message: showBlockedOnly
                                ? "Nothing is blocked in this queue."
                                : "No groups are queued."
                        )
                    } else {
                        ForEach(visible) { group in
                            NavigationLink {
                                GroupDetailView(client: client, queueName: queue.name, group: group)
                            } label: {
                                GroupRow(group: group)
                            }
                        }
                    }
                }
            } header: {
                Text("Groups")
            } footer: {
                if let page = groups.state.value, page.total > page.groups.count {
                    Text("Showing \(page.groups.count) of \(Format.count(page.total)). Open the web console for the full list.")
                }
            }

            pausesSection
        }
        .navigationTitle(queue.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await groups.refresh()
            await pausedKeys.refresh()
            await pausedTenants.refresh()
        }
        .task {
            groups.loadIfNeeded()
            pausedKeys.loadIfNeeded()
            pausedTenants.loadIfNeeded()
        }
    }

    @ViewBuilder
    private var pausesSection: some View {
        let keys = pausedKeys.state.value ?? []
        let tenants = pausedTenants.state.value ?? []

        if !keys.isEmpty || !tenants.isEmpty {
            Section {
                ForEach(keys, id: \.self) { key in
                    Label(key, systemImage: "pause.circle")
                        .font(.footnote.monospaced())
                }
                ForEach(tenants, id: \.self) { tenant in
                    Label(tenant, systemImage: "person.crop.circle.badge.minus")
                        .font(.footnote.monospaced())
                }
            } header: {
                Text("Paused")
            } footer: {
                Text("Pausing and unpausing happen in the web console.")
            }
        }
    }

    private func filtered(_ groups: [QueueGroup]) -> [QueueGroup] {
        let candidates = showBlockedOnly ? groups.filter(\.isBlocked) : groups
        return candidates.sorted { left, right in
            if left.isBlocked != right.isBlocked { return left.isBlocked }
            return left.pendingJobs > right.pendingJobs
        }
    }
}

struct GroupRow: View {
    let group: QueueGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(group.groupId)
                    .font(.subheadline.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                if group.isBlocked {
                    StatusPill(text: group.isStaleBlock ? "stale" : "blocked", severity: .critical)
                } else if group.hasActiveJob {
                    StatusPill(text: "active")
                }
            }

            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)

            if let error = group.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }

    private var subtitle: String {
        var parts = ["\(Format.count(group.pendingJobs)) jobs"]
        if let pipeline = group.pipelineName { parts.append(pipeline) }
        if let oldest = group.oldestJobMs {
            let age = Date().timeIntervalSince1970 - oldest / 1000
            if age > 0 { parts.append("oldest \(Format.duration(seconds: age))") }
        }
        return parts.joined(separator: " · ")
    }
}

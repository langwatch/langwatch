import SwiftUI

/// The queue list.
///
/// Sorted by trouble, not by name: a queue with blocked groups goes above a
/// healthy one with a bigger backlog, because backlog drains on its own and a
/// block does not.
struct QueuesView: View {
    private let client: OpsClient
    @StateObject private var loader: Loader<[QueueSummary]>

    init(client: OpsClient) {
        self.client = client
        _loader = StateObject(wrappedValue: Loader { try await client.queues() })
    }

    var body: some View {
        NavigationStack {
            List {
                LoadableView(state: loader.state, retry: { loader.reload() }) { queues in
                    if queues.isEmpty {
                        EmptyStateRow(message: "No group queues are registered on this instance.")
                    } else {
                        ForEach(sorted(queues)) { queue in
                            NavigationLink {
                                QueueDetailView(client: client, queue: queue)
                            } label: {
                                QueueRow(queue: queue)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Queues")
            .refreshable { await loader.refresh() }
            .task { loader.loadIfNeeded() }
        }
    }

    private func sorted(_ queues: [QueueSummary]) -> [QueueSummary] {
        queues.sorted { left, right in
            if left.needsAttention != right.needsAttention { return left.needsAttention }
            if left.blockedGroupCount != right.blockedGroupCount {
                return left.blockedGroupCount > right.blockedGroupCount
            }
            if left.dlqCount != right.dlqCount { return left.dlqCount > right.dlqCount }
            return left.totalPendingJobs > right.totalPendingJobs
        }
    }
}

struct QueueRow: View {
    let queue: QueueSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(queue.displayName)
                    .font(.headline)
                Spacer()
                if queue.blockedGroupCount > 0 {
                    StatusPill(text: "\(queue.blockedGroupCount) blocked", severity: .critical)
                }
                if queue.dlqCount > 0 {
                    StatusPill(text: "\(queue.dlqCount) dead", severity: .warning)
                }
            }
            Text(summary)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private var summary: String {
        var parts = [
            "\(Format.count(queue.pendingGroupCount)) pending",
            "\(Format.count(queue.activeGroupCount)) active",
            "\(Format.count(queue.totalPendingJobs)) jobs",
        ]
        if queue.parkedGroupCount > 0 {
            parts.append("\(Format.count(queue.parkedGroupCount)) parked")
        }
        return parts.joined(separator: " · ")
    }
}

import SwiftUI

/// The payload store: where the bytes are, and what a sweep would do about it.
struct PayloadStoreView: View {
    private let client: OpsClient
    @StateObject private var stats: Loader<BlobStoreStats>
    @State private var showingSweep = false

    init(client: OpsClient) {
        self.client = client
        _stats = StateObject(wrappedValue: Loader { try await client.blobStoreStats() })
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LoadableView(state: stats.state, retry: { stats.reload() }) { stats in
                        if stats.queues.isEmpty {
                            EmptyStateRow(message: "No queues are holding payloads.")
                        } else {
                            ForEach(stats.queues) { queue in
                                NavigationLink {
                                    BlobListView(client: client, queueName: queue.queueName)
                                } label: {
                                    QueueStatsRow(stats: queue)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Queues")
                } footer: {
                    Text("Counts are sampled. A full count of a multi-million-key keyspace is not something a request can do.")
                }

                Section {
                    Button {
                        showingSweep = true
                    } label: {
                        Label("Run a cleanup sweep", systemImage: "arrow.3.trianglepath")
                    }
                } footer: {
                    Text("Trial it first. The trial reports exactly what a real sweep would reclaim, without deleting anything.")
                }
            }
            .navigationTitle("Payload store")
            .refreshable { await stats.refresh() }
            .task { stats.loadIfNeeded() }
            .sheet(isPresented: $showingSweep) {
                SweepSheet(client: client) {
                    // A real sweep changes the totals this screen is showing.
                    stats.reload()
                }
            }
        }
    }
}

private struct QueueStatsRow: View {
    let stats: BlobStoreStats.QueueStats

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(stats.queueName)
                    .font(.subheadline.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                Text(Format.bytes(stats.sampledBytes))
                    .font(.subheadline.monospacedDigit())
            }
            HStack(spacing: 6) {
                Text("\(Format.count(stats.sampledBlobs)) sampled")
                if stats.unreferenced > 0 {
                    Text("· \(Format.count(stats.unreferenced)) unreferenced")
                        .foregroundStyle(.orange)
                }
                if stats.truncated {
                    Text("· sample capped")
                        .foregroundStyle(.secondary)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}

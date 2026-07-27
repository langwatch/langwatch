import SwiftUI

/// Paging state for one queue's blob listing.
///
/// Its own model rather than a pile of `@State`, because the listing is the one
/// screen in the app with real state: an order, a filter, an opaque cursor and
/// an accumulating page, all of which have to reset together when the order
/// changes or the cursor stops meaning anything.
@MainActor
final class BlobListModel: ObservableObject {
    @Published var sort: BlobSort = .largest {
        didSet { if oldValue != sort { reload() } }
    }
    @Published var projectFilter = ""

    @Published private(set) var blobs: [BlobSummary] = []
    @Published private(set) var page: BlobPage?
    @Published private(set) var failure: Error?
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false

    let client: OpsClient
    private let queueName: String
    private var task: Task<Void, Never>?

    init(client: OpsClient, queueName: String) {
        self.client = client
        self.queueName = queueName
    }

    var canLoadMore: Bool { page?.nextCursor != nil }
    var isEmpty: Bool { blobs.isEmpty && !isLoading && failure == nil && page != nil }

    func loadIfNeeded() {
        guard page == nil, !isLoading else { return }
        reload()
    }

    func reload() {
        task?.cancel()
        task = Task { await fetch(cursor: nil) }
    }

    func refresh() async {
        task?.cancel()
        await fetch(cursor: nil)
    }

    func loadMore() {
        guard let cursor = page?.nextCursor, !isLoadingMore else { return }
        task?.cancel()
        task = Task { await fetch(cursor: cursor) }
    }

    private func fetch(cursor: String?) async {
        let isFirstPage = cursor == nil
        if isFirstPage { isLoading = true } else { isLoadingMore = true }
        defer {
            isLoading = false
            isLoadingMore = false
        }

        do {
            let result = try await client.blobs(
                queueName: queueName,
                sort: sort,
                projectId: projectFilter.isEmpty ? nil : projectFilter,
                cursor: cursor
            )
            guard !Task.isCancelled else { return }
            page = result
            blobs = isFirstPage ? result.blobs : blobs + result.blobs
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            // A failure part-way through a walk keeps what was already loaded:
            // the operator was reading it, and blanking the list to show an
            // error loses the thing they were looking at.
            if isFirstPage { blobs = [] }
            failure = error
        }
    }
}

/// One queue's blobs, ordered by whatever the operator is hunting for.
///
/// The ordering control is the screen's whole point: "largest" answers what is
/// occupying the instance, "unreferenced" answers what could be reclaimed, and
/// "lapsed lease" answers where a worker died mid-flight. Every one of those but
/// `scan` ranks a bounded sample, and the list says so rather than implying a
/// true top-N it cannot compute.
struct BlobListView: View {
    @StateObject private var model: BlobListModel
    private let queueName: String

    init(client: OpsClient, queueName: String) {
        self.queueName = queueName
        _model = StateObject(wrappedValue: BlobListModel(client: client, queueName: queueName))
    }

    var body: some View {
        List {
            Section {
                Picker("Order", selection: $model.sort) {
                    ForEach(BlobSort.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.menu)

                TextField("Filter by project id", text: $model.projectFilter)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.subheadline)
                    .onSubmit { model.reload() }
            } footer: {
                Text(model.sort.explanation)
            }

            Section {
                listBody
            } header: {
                Text("Payloads")
            } footer: {
                samplingFooter
            }
        }
        .navigationTitle(queueName)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.refresh() }
        .task { model.loadIfNeeded() }
    }

    @ViewBuilder
    private var listBody: some View {
        if let failure = model.failure, model.blobs.isEmpty {
            ErrorStateView(error: failure, retry: { model.reload() })
        } else if model.blobs.isEmpty && model.isLoading {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
        } else if model.isEmpty {
            EmptyStateRow(message: "No payloads matched.")
        } else {
            ForEach(model.blobs) { blob in
                NavigationLink {
                    BlobDetailView(client: model.client, blob: blob)
                } label: {
                    BlobRow(blob: blob)
                }
            }

            if model.canLoadMore {
                Button(action: { model.loadMore() }) {
                    HStack {
                        if model.isLoadingMore { ProgressView().controlSize(.small) }
                        Text(model.isLoadingMore ? "Loading…" : "Load more")
                    }
                    .frame(maxWidth: .infinity)
                }
                .disabled(model.isLoadingMore)
            }
        }
    }

    @ViewBuilder
    private var samplingFooter: some View {
        if let page = model.page {
            if page.rankedFromSample {
                Text("Ranked from the \(Format.count(page.sampled)) payloads examined — the top of that sample, not the top of everything stored.")
            } else {
                Text("Examined \(Format.count(page.sampled)) payloads in storage order. This walk is complete and resumable.")
            }
        }
    }
}

private struct BlobRow: View {
    let blob: BlobSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(blob.hash)
                    .font(.caption.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                Text(Format.bytes(blob.sizeBytes))
                    .font(.subheadline.monospacedDigit().weight(.medium))
            }
            HStack(spacing: 6) {
                Text(blob.projectId)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("·")
                Text(leaseSummary)
                    .foregroundStyle(blob.isReclaimable ? Color.orange : Color.secondary)
                Spacer(minLength: 4)
                StatusPill(text: blob.sweepOutcome, severity: outcomeSeverity)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    private var leaseSummary: String {
        if blob.liveLeases == 0 { return "no live lease" }
        return "\(blob.liveLeases) lease\(blob.liveLeases == 1 ? "" : "s")"
    }

    private var outcomeSeverity: StatSeverity {
        switch blob.sweepOutcome {
        case "reclaimed": return .critical
        case "repaired", "bookkeeping": return .warning
        default: return .normal
        }
    }
}

struct BlobDetailView: View {
    /// The listing's copy, shown immediately so the screen never opens empty,
    /// then replaced by a re-read: leases and the sweep outcome move while a
    /// listing sits on screen, and the outcome is the one figure here an
    /// operator would act on.
    @State private var blob: BlobSummary
    private let client: OpsClient

    init(client: OpsClient, blob: BlobSummary) {
        self.client = client
        _blob = State(initialValue: blob)
    }

    var body: some View {
        List {
            Section("Payload") {
                DetailRow(label: "Hash", value: blob.hash, isMonospaced: true)
                DetailRow(label: "Project", value: blob.projectId, isMonospaced: true)
                DetailRow(label: "Queue", value: blob.queueName, isMonospaced: true)
                DetailRow(label: "Size", value: Format.bytes(blob.sizeBytes))
            }

            Section {
                DetailRow(label: "Live leases", value: String(blob.liveLeases))
                DetailRow(label: "Holder tokens", value: String(blob.holderTokens))
                DetailRow(label: "Expires in", value: ttlText)
                if let lapsed = lapsedLeaseText {
                    DetailRow(label: "Oldest lease deadline", value: lapsed)
                }
            } header: {
                Text("Retention")
            } footer: {
                Text("Every access re-arms the expiry, so a low remaining time means nothing has read or staged this in a while.")
            }

            Section {
                DetailRow(label: "A sweep would", value: blob.sweepOutcome)
                Text(outcomeExplanation)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } header: {
                Text("Sweep")
            }

            Section {
                Text("Deleting a single payload is only possible from the web console. This app can run the sweep, which decides by rule rather than by hand.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Payload")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await reload() }
        .task { await reload() }
    }

    /// A failure here leaves the listing's copy on screen. It is the same blob,
    /// just read a moment earlier — better than an error page over data the
    /// operator already has.
    private func reload() async {
        guard
            let fresh = try? await client.blob(
                queueName: blob.queueName,
                projectId: blob.projectId,
                hash: blob.hash
            )
        else { return }
        blob = fresh
    }

    private var ttlText: String {
        guard let ttl = blob.ttlSeconds else { return "never — no expiry set" }
        return Format.duration(seconds: ttl)
    }

    /// A deadline in the past dates the oldest LAPSED lease: how long ago the
    /// holder that should have released this stopped renewing. That is the
    /// sharpest available signal for "a worker died here".
    private var lapsedLeaseText: String? {
        guard let deadlineMs = blob.earliestLeaseDeadlineMs else { return nil }
        let deadline = Date(timeIntervalSince1970: deadlineMs / 1000)
        if deadline < Date() {
            return "lapsed \(Format.relative(deadline))"
        }
        return "in \(Format.duration(seconds: deadline.timeIntervalSinceNow))"
    }

    private var outcomeExplanation: String {
        switch blob.sweepOutcome {
        case "leased":
            return "A live lease still references it. A sweep leaves it alone."
        case "repaired":
            return "Unleased and holding longer than the grace window. A sweep shortens its expiry — it never destroys bytes."
        case "reclaimed":
            return "Unleased and past the safety margin. A real sweep deletes the bytes."
        case "bookkeeping":
            return "The bytes are already gone. A sweep only drops the stale lease and holder keys."
        case "pending":
            return "Unleased and already counting down inside the margin. A sweep leaves it to expire."
        default:
            return "This instance reported an outcome this app does not recognise."
        }
    }
}

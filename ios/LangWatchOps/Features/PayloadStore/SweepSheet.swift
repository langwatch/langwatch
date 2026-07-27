import SwiftUI

/// The confirmation word a real sweep requires. The server checks the same
/// literal, so a client that skipped this step would still be refused — the
/// typing is here to make the act deliberate, not to be the security boundary.
let sweepConfirmationWord = "RECLAIM"

@MainActor
final class SweepModel: ObservableObject {
    enum Phase: Equatable {
        case ready
        case running(dryRun: Bool)
        case finished(BlobSweepReport)
        case failed(String)

        static func == (lhs: Phase, rhs: Phase) -> Bool {
            switch (lhs, rhs) {
            case (.ready, .ready): return true
            case let (.running(a), .running(b)): return a == b
            case let (.failed(a), .failed(b)): return a == b
            case let (.finished(a), .finished(b)):
                return a.dryRun == b.dryRun && a.totals.reclaimed == b.totals.reclaimed
            default: return false
            }
        }
    }

    @Published private(set) var phase: Phase = .ready
    @Published var confirmationText = ""

    private let client: OpsClient

    init(client: OpsClient) {
        self.client = client
    }

    /// True once the operator has typed the confirmation word exactly.
    ///
    /// Exactly: no trimming, no case folding. Half the value of a typed
    /// confirmation is that it cannot be produced by a thumb brushing the
    /// screen, and a forgiving comparison gives that away.
    var isConfirmed: Bool { confirmationText == sweepConfirmationWord }

    /// The reclaim is only offered after a trial, so the number on the button is
    /// one the operator has already seen.
    var trialReport: BlobSweepReport? {
        guard case let .finished(report) = phase, report.dryRun else { return nil }
        return report
    }

    var isRunning: Bool {
        if case .running = phase { return true }
        return false
    }

    func runTrial() {
        run(dryRun: true)
    }

    func runForReal() {
        guard isConfirmed else { return }
        run(dryRun: false)
    }

    func startOver() {
        phase = .ready
        confirmationText = ""
    }

    private func run(dryRun: Bool) {
        phase = .running(dryRun: dryRun)
        Task {
            do {
                let report = try await client.runBlobSweep(
                    dryRun: dryRun,
                    confirm: dryRun ? nil : sweepConfirmationWord
                )
                phase = .finished(report)
                confirmationText = ""
            } catch {
                phase = .failed(error.localizedDescription)
            }
        }
    }
}

/// Trial, then reclaim.
///
/// The order is the design: the trial and the real sweep run the same code on
/// the server, so the tally an operator approves is the tally the sweep
/// produced, not an estimate arrived at some other way.
struct SweepSheet: View {
    @StateObject private var model: SweepModel
    @Environment(\.dismiss) private var dismiss
    private let onReclaimed: () -> Void

    init(client: OpsClient, onReclaimed: @escaping () -> Void) {
        self.onReclaimed = onReclaimed
        _model = StateObject(wrappedValue: SweepModel(client: client))
    }

    var body: some View {
        NavigationStack {
            List {
                switch model.phase {
                case .ready:
                    readySection
                case let .running(dryRun):
                    Section {
                        HStack {
                            ProgressView()
                            Text(dryRun ? "Working out what would be reclaimed…" : "Reclaiming…")
                                .foregroundStyle(.secondary)
                        }
                    }
                case let .finished(report):
                    reportSections(report)
                case let .failed(message):
                    Section {
                        Label(message, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                        Button("Start over") { model.startOver() }
                    }
                }
            }
            .navigationTitle("Cleanup sweep")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .interactiveDismissDisabled(model.isRunning)
        }
    }

    private var readySection: some View {
        Section {
            Button {
                model.runTrial()
            } label: {
                Label("Run a trial", systemImage: "eyeglasses")
            }
        } footer: {
            Text("A trial walks the payload store and reports what a real sweep would reclaim, repair and leave pending. It deletes nothing.")
        }
    }

    @ViewBuilder
    private func reportSections(_ report: BlobSweepReport) -> some View {
        Section {
            StatGrid {
                StatTile(
                    title: report.dryRun ? "Would reclaim" : "Reclaimed",
                    value: Format.count(report.totals.reclaimed),
                    caption: "payloads",
                    severity: report.totals.reclaimed > 0 ? .warning : .normal
                )
                StatTile(
                    title: report.dryRun ? "Would repair" : "Repaired",
                    value: Format.count(report.totals.repaired),
                    caption: "expiry shortened"
                )
                StatTile(
                    title: "Still leased",
                    value: Format.count(report.totals.leased),
                    caption: "left alone"
                )
                StatTile(
                    title: "Examined",
                    value: Format.count(report.totals.scanned),
                    caption: report.totals.truncated ? "ceiling reached" : "complete"
                )
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        } header: {
            Text(report.dryRun ? "Trial result" : "Sweep result")
        } footer: {
            Text("Took \(Format.milliseconds(report.durationMs)).")
        }

        if !report.queues.isEmpty {
            Section("By queue") {
                ForEach(report.queues) { queue in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(queue.queueName)
                            .font(.subheadline.monospaced())
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Text("\(queue.reclaimed) reclaimed · \(queue.repaired) repaired · \(queue.pending) pending · \(queue.leased) leased")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }

        if report.dryRun {
            confirmationSection(report)
        } else {
            Section {
                Button("Done") {
                    onReclaimed()
                    dismiss()
                }
            }
        }
    }

    @ViewBuilder
    private func confirmationSection(_ report: BlobSweepReport) -> some View {
        if report.totals.reclaimed == 0 && report.totals.repaired == 0 {
            Section {
                Label("Nothing to reclaim.", systemImage: "checkmark.circle")
                    .foregroundStyle(.green)
                Button("Run another trial") { model.startOver() }
            }
        } else {
            Section {
                TextField(sweepConfirmationWord, text: $model.confirmationText)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())

                Button(role: .destructive) {
                    model.runForReal()
                } label: {
                    Label(
                        "Reclaim \(Format.count(report.totals.reclaimed)) payloads",
                        systemImage: "trash"
                    )
                }
                .disabled(!model.isConfirmed)
            } header: {
                Text("Reclaim for real")
            } footer: {
                Text("This deletes the payload bytes and cannot be undone. Type \(sweepConfirmationWord) to enable it.")
            }
        }
    }
}

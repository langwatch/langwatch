import Foundation

enum Loadable<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(Error)

    var value: Value? {
        if case let .loaded(value) = self { return value }
        return nil
    }
}

/// Drives one screen's fetch: the state it renders from, plus when it last
/// succeeded.
///
/// `lastLoadedAt` is not decoration. A dashboard that keeps showing the previous
/// numbers after a refresh fails is lying by omission, so screens stamp their
/// figures with an age and say so when it grows.
@MainActor
final class Loader<Value>: ObservableObject {
    @Published private(set) var state: Loadable<Value> = .idle
    @Published private(set) var lastLoadedAt: Date?
    /// Set when a refresh fails but earlier data is still on screen.
    @Published private(set) var refreshFailure: Error?

    private let operation: @Sendable () async throws -> Value
    private var inFlight: Task<Void, Never>?

    init(operation: @escaping @Sendable () async throws -> Value) {
        self.operation = operation
    }

    /// Load once. Repeated calls while data is already on screen are no-ops, so
    /// `.task` on a view that reappears does not blank it.
    func loadIfNeeded() {
        guard case .idle = state else { return }
        reload()
    }

    func reload() {
        inFlight?.cancel()
        if state.value == nil { state = .loading }
        inFlight = Task { [weak self] in
            await self?.run()
        }
    }

    /// For `.refreshable`, which needs to await the work so the spinner lives
    /// as long as the fetch does.
    func refresh() async {
        inFlight?.cancel()
        await run()
    }

    private func run() async {
        do {
            let value = try await operation()
            guard !Task.isCancelled else { return }
            state = .loaded(value)
            lastLoadedAt = Date()
            refreshFailure = nil
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            if state.value != nil {
                // Keep the stale data visible but flag it — an operator staring
                // at a queue depth needs to know the number stopped updating.
                refreshFailure = error
            } else {
                state = .failed(error)
            }
        }
    }
}

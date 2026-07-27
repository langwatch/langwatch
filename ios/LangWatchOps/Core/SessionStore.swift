import Foundation

/// Owns the stored session and is the only thing allowed to refresh it.
///
/// An actor rather than a lock because refresh MUST be serialized: the server
/// rotates the refresh token on every call, so two screens each noticing an
/// expired access token at the same moment would race, and the loser would hold
/// a refresh token the server has already retired. `refreshTask` collapses
/// concurrent callers onto one in-flight refresh and hands them all the same
/// result.
actor SessionStore {
    private let keychain: Keychain
    private let deviceFlow: DeviceFlowClient
    private let account = "device-session"

    private var cached: StoredSession?
    private var refreshTask: Task<StoredSession, Error>?

    init(keychain: Keychain, deviceFlow: DeviceFlowClient) {
        self.keychain = keychain
        self.deviceFlow = deviceFlow
    }

    /// Whatever is stored, without touching the network.
    func current() -> StoredSession? {
        if let cached { return cached }
        guard let data = keychain.data(for: account) else { return nil }
        let session = try? JSONDecoder().decode(StoredSession.self, from: data)
        cached = session
        return session
    }

    func store(_ session: StoredSession) throws {
        let data = try JSONEncoder().encode(session)
        try keychain.set(data, for: account)
        cached = session
    }

    func clear() {
        refreshTask?.cancel()
        refreshTask = nil
        cached = nil
        keychain.remove(account)
    }

    /// A session whose access token is good to use right now.
    ///
    /// `force` is for the 401 path: the token looked valid by its own clock but
    /// the server disagreed — a revocation, or a clock that drifted — so refresh
    /// regardless of what the expiry says.
    func validSession(force: Bool = false) async throws -> StoredSession {
        guard let session = current() else { throw OpsError.signedOut }
        if !force && !session.isExpired() { return session }

        if let refreshTask {
            return try await refreshTask.value
        }

        // Inherits this actor's isolation, so `store` below is a plain isolated
        // call and no second serialization mechanism is needed.
        let task = Task<StoredSession, Error> {
            let refreshed = try await self.deviceFlow.refresh(session: session)
            try self.store(refreshed)
            return refreshed
        }
        refreshTask = task

        do {
            let refreshed = try await task.value
            refreshTask = nil
            return refreshed
        } catch {
            refreshTask = nil
            // A rejected refresh token is terminal: nothing the app holds can
            // recover it, so drop the session rather than leaving a dead
            // credential in the keychain to fail every subsequent screen.
            if (error as? DeviceFlowClient.Failure) == .refreshRejected {
                clear()
                throw OpsError.signedOut
            }
            throw error
        }
    }
}

import Foundation

/// The signed-in session, as persisted in the keychain.
///
/// Carries the instance it belongs to, because an operator with a self-hosted
/// instance and LangWatch Cloud must never have a token from one silently sent
/// to the other.
struct StoredSession: Codable, Sendable, Equatable {
    let instance: URL
    let accessToken: String
    let refreshToken: String
    let accessTokenExpiresAt: Date
    let userId: String
    let userEmail: String?
    let userName: String?
    let organizationName: String?

    /// Refresh a little before the token actually dies, so a request that takes
    /// a moment to reach the server does not arrive holding an expired
    /// credential and pay for a retry.
    static let refreshMargin: TimeInterval = 60

    func isExpired(asOf now: Date = Date(), margin: TimeInterval = StoredSession.refreshMargin) -> Bool {
        accessTokenExpiresAt.addingTimeInterval(-margin) <= now
    }

    func renewed(accessToken: String, refreshToken: String, expiresAt: Date) -> StoredSession {
        StoredSession(
            instance: instance,
            accessToken: accessToken,
            refreshToken: refreshToken,
            accessTokenExpiresAt: expiresAt,
            userId: userId,
            userEmail: userEmail,
            userName: userName,
            organizationName: organizationName
        )
    }

    var displayName: String {
        userName ?? userEmail ?? "Signed in"
    }
}

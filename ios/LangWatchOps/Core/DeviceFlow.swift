import Foundation
import UIKit

/// The RFC 8628 device-authorization grant, as served by
/// `langwatch/src/server/routes/auth-cli.ts`.
///
/// The app never sees a password: it asks for a device code, sends the operator
/// to the instance's own sign-in page to approve it, and polls until tokens come
/// back. That also means SSO, MFA and whatever else the instance enforces at the
/// browser stay enforced — this client cannot bypass any of it because it never
/// handles the credential.
///
/// Wire format is snake_case JSON to match RFC 8628.
struct DeviceFlowClient: Sendable {
    private let urlSession: URLSession

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    struct Challenge: Sendable, Equatable {
        let deviceCode: String
        /// The short code shown to the operator, e.g. "WDJB-MJHT".
        let userCode: String
        /// Where to send them. Already carries the user code as a query item.
        let verificationURL: URL
        let expiresAt: Date
        /// Minimum seconds between polls; the server rate-limits below this.
        let pollInterval: TimeInterval
    }

    enum Failure: Error, LocalizedError, Equatable {
        /// The operator has not approved yet. Keep polling.
        case authorizationPending
        /// Polled too fast; back off and retry.
        case slowDown
        /// The device code expired before it was approved.
        case expired
        /// The operator explicitly declined in the browser.
        case denied
        /// The refresh token is unknown or revoked — sign out.
        case refreshRejected
        case server(status: Int, message: String)
        case malformedInstanceURL

        var errorDescription: String? {
            switch self {
            case .authorizationPending: return "Waiting for approval."
            case .slowDown: return "Checking too often."
            case .expired: return "The sign-in request expired. Start again."
            case .denied: return "Sign-in was declined."
            case .refreshRejected: return "This session is no longer valid. Sign in again."
            case let .server(status, message): return "\(message) (HTTP \(status))"
            case .malformedInstanceURL: return "That does not look like a LangWatch address."
            }
        }
    }

    // MARK: - Requesting a code

    func requestDeviceCode(instance: URL) async throws -> Challenge {
        struct Response: Decodable {
            let device_code: String
            let user_code: String
            let verification_uri: String
            let verification_uri_complete: String
            let expires_in: Int
            let interval: Int
        }

        let response: Response = try await post(
            instance: instance,
            path: "/api/auth/cli/device-code",
            body: EmptyBody()
        )

        guard let url = URL(string: response.verification_uri_complete) else {
            throw Failure.malformedInstanceURL
        }

        return Challenge(
            deviceCode: response.device_code,
            userCode: response.user_code,
            verificationURL: url,
            expiresAt: Date().addingTimeInterval(TimeInterval(response.expires_in)),
            pollInterval: TimeInterval(response.interval)
        )
    }

    // MARK: - Exchanging it for tokens

    /// One poll. Throws `.authorizationPending` while the operator has not yet
    /// approved — the caller loops on that, honouring `Challenge.pollInterval`.
    func exchange(deviceCode: String, instance: URL) async throws -> StoredSession {
        struct Body: Encodable {
            let device_code: String
            let client_info: ClientInfo
        }
        struct ClientInfo: Encodable {
            let device_label: String
            let platform: String
        }
        struct Response: Decodable {
            let access_token: String
            let expires_in: Int
            let refresh_token: String
            let user: User
            let organization: Organization

            struct User: Decodable {
                let id: String
                let email: String?
                let name: String?
            }
            struct Organization: Decodable {
                let id: String
                let name: String
            }
        }

        let body = Body(
            device_code: deviceCode,
            client_info: ClientInfo(
                device_label: await deviceLabel(),
                platform: "ios"
            )
        )

        let response: Response = try await post(
            instance: instance,
            path: "/api/auth/cli/exchange",
            body: body
        )

        return StoredSession(
            instance: instance,
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            accessTokenExpiresAt: Date().addingTimeInterval(TimeInterval(response.expires_in)),
            userId: response.user.id,
            userEmail: response.user.email,
            userName: response.user.name,
            organizationName: response.organization.name
        )
    }

    // MARK: - Refreshing

    /// Trade the refresh token for a fresh pair. The server rotates the refresh
    /// token on every call, so the returned session must replace the stored one
    /// atomically — see `SessionStore`, which serializes refreshes for exactly
    /// this reason.
    func refresh(session: StoredSession) async throws -> StoredSession {
        struct Body: Encodable {
            let refresh_token: String
        }
        struct Response: Decodable {
            let access_token: String
            let expires_in: Int
            let refresh_token: String
        }

        let response: Response = try await post(
            instance: session.instance,
            path: "/api/auth/cli/refresh",
            body: Body(refresh_token: session.refreshToken)
        )

        return session.renewed(
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            expiresAt: Date().addingTimeInterval(TimeInterval(response.expires_in))
        )
    }

    // MARK: - Transport

    private struct EmptyBody: Encodable {}

    private func post<Body: Encodable, Response: Decodable>(
        instance: URL,
        path: String,
        body: Body
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: instance) else {
            throw Failure.malformedInstanceURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, urlResponse) = try await urlSession.data(for: request)
        let status = (urlResponse as? HTTPURLResponse)?.statusCode ?? 0

        if (200..<300).contains(status) {
            return try JSONDecoder().decode(Response.self, from: data)
        }

        throw Self.failure(status: status, data: data)
    }

    /// Map the RFC 8628 error codes onto the cases the sign-in loop branches on.
    /// The status codes come straight from the server's spec table: 428
    /// pending, 429 slow down, 408 expired, 410 denied, 401 refresh rejected.
    static func failure(status: Int, data: Data) -> Failure {
        struct ErrorBody: Decodable {
            let error: String?
            let error_description: String?
        }
        let body = try? JSONDecoder().decode(ErrorBody.self, from: data)

        switch status {
        case 428: return .authorizationPending
        case 429: return .slowDown
        case 408: return .expired
        case 410: return .denied
        case 401: return .refreshRejected
        default: break
        }

        // Fall back to the RFC error code, so a proxy that rewrote the status
        // does not turn a pending approval into a hard failure.
        switch body?.error {
        case "authorization_pending": return .authorizationPending
        case "slow_down": return .slowDown
        case "expired_token": return .expired
        case "access_denied": return .denied
        case "invalid_grant": return .refreshRejected
        default:
            return .server(
                status: status,
                message: body?.error_description ?? "Sign-in failed"
            )
        }
    }

    @MainActor
    private func deviceLabel() -> String {
        UIDevice.current.name
    }
}

import Foundation

enum OpsError: Error, LocalizedError, Equatable {
    /// No stored session, or the one we had is dead. The UI returns to sign-in.
    case signedOut
    /// Authenticated, but this account is not a platform operator.
    case noOpsAccess
    /// The instance is running without the ops module (a worker-only role, say).
    case opsModuleUnavailable(String)
    case notFound
    case http(status: Int, message: String)
    case transport(String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .signedOut:
            return "Your session has ended. Sign in again."
        case .noOpsAccess:
            return "This account does not have ops access."
        case let .opsModuleUnavailable(message):
            return message
        case .notFound:
            return "That is no longer there."
        case let .http(status, message):
            return "\(message) (HTTP \(status))"
        case let .transport(message):
            return "Could not reach the instance. \(message)"
        case let .decoding(message):
            return "The instance sent something this version does not understand. \(message)"
        }
    }

    /// True when retrying could plausibly work — drives whether a failed screen
    /// offers a retry button or an explanation.
    var isRetryable: Bool {
        switch self {
        case .transport, .http, .opsModuleUnavailable: return true
        case .signedOut, .noOpsAccess, .notFound, .decoding: return false
        }
    }
}

/// Talks to `/api/ops/mobile/*`.
///
/// Every call goes through `send`, which attaches the bearer token, and on a 401
/// forces one token refresh and retries exactly once. Once, not in a loop: a
/// second 401 after a fresh token means the credential is genuinely rejected,
/// and retrying would just spin.
final class OpsClient: Sendable {
    private let sessions: SessionStore
    private let urlSession: URLSession

    init(sessions: SessionStore, urlSession: URLSession = .shared) {
        self.sessions = sessions
        self.urlSession = urlSession
    }

    // MARK: - Endpoints

    func scope() async throws -> ScopeResponse {
        try await get("scope")
    }

    func dashboard() async throws -> DashboardResponse {
        try await get("dashboard")
    }

    func badgeCounts() async throws -> BadgeCounts {
        try await get("badge")
    }

    func queues() async throws -> [QueueSummary] {
        let response: QueuesResponse = try await get("queues")
        return response.queues
    }

    func groups(queueName: String, page: Int = 1, pageSize: Int = 50) async throws -> GroupsPage {
        try await get("groups", query: [
            "queueName": queueName,
            "page": String(page),
            "pageSize": String(pageSize),
        ])
    }

    func groupJobs(
        queueName: String,
        groupId: String,
        page: Int = 1,
        pageSize: Int = 20
    ) async throws -> JobsPage {
        try await get("group-jobs", query: [
            "queueName": queueName,
            "groupId": groupId,
            "page": String(page),
            "pageSize": String(pageSize),
        ])
    }

    func blockedSummary() async throws -> BlockedSummary {
        try await get("blocked-summary")
    }

    func pausedKeys(queueName: String) async throws -> [String] {
        let response: PausedKeysResponse = try await get("paused-keys", query: ["queueName": queueName])
        return response.keys
    }

    func pausedTenants(queueName: String) async throws -> [String] {
        let response: PausedTenantsResponse = try await get("paused-tenants", query: ["queueName": queueName])
        return response.tenants
    }

    func deadLetterGroups() async throws -> [DlqGroup] {
        let response: DlqResponse = try await get("dlq")
        return response.groups
    }

    func anomalies() async throws -> [Anomaly] {
        let response: AnomaliesResponse = try await get("anomalies")
        return response.anomalies
    }

    func scheduledJobs(limit: Int = 200) async throws -> [ScheduledJob] {
        let response: SchedulerResponse = try await get("scheduler", query: ["limit": String(limit)])
        return response.jobs
    }

    func foundryPresets() async throws -> [FoundryPreset] {
        let response: FoundryPresetsResponse = try await get("foundry/presets")
        return response.presets
    }

    func blobStoreStats() async throws -> BlobStoreStats {
        try await get("blobs/stats")
    }

    /// One blob, re-read. The detail screen opens on the summary the listing
    /// already had and then refreshes it: a blob's leases and sweep outcome move
    /// while the listing sits on screen, and a stale outcome is the one figure
    /// on that screen an operator would act on.
    func blob(queueName: String, projectId: String, hash: String) async throws -> BlobSummary {
        struct Response: Decodable { let blob: BlobSummary }
        let response: Response = try await get("blob", query: [
            "queueName": queueName,
            "projectId": projectId,
            "hash": hash,
        ])
        return response.blob
    }

    func blobs(
        queueName: String,
        sort: BlobSort,
        projectId: String? = nil,
        cursor: String? = nil,
        limit: Int = 50
    ) async throws -> BlobPage {
        var query = [
            "queueName": queueName,
            "sort": sort.rawValue,
            "limit": String(limit),
        ]
        if let projectId, !projectId.isEmpty { query["projectId"] = projectId }
        if let cursor { query["cursor"] = cursor }
        return try await get("blobs", query: query)
    }

    /// The only write. `dryRun: true` is the trial; the destructive form needs
    /// the confirmation word, which the server checks again on its side.
    func runBlobSweep(dryRun: Bool, confirm: String? = nil) async throws -> BlobSweepReport {
        struct Body: Encodable {
            let dryRun: Bool
            let confirm: String?
        }
        return try await post("blobs/sweep", body: Body(dryRun: dryRun, confirm: confirm))
    }

    func projections() async throws -> ProjectionCatalog {
        try await get("projections")
    }

    func replayStatus() async throws -> ReplayStatus {
        try await get("replay/status")
    }

    func replayHistory() async throws -> [ReplayRun] {
        let response: ReplayHistoryResponse = try await get("replay/history")
        return response.history
    }

    // MARK: - Transport

    private func get<Response: Decodable>(
        _ path: String,
        query: [String: String] = [:]
    ) async throws -> Response {
        try await send(path: path, method: "GET", query: query, body: nil)
    }

    private func post<Body: Encodable, Response: Decodable>(
        _ path: String,
        body: Body
    ) async throws -> Response {
        let data = try JSONEncoder().encode(body)
        return try await send(path: path, method: "POST", query: [:], body: data)
    }

    private func send<Response: Decodable>(
        path: String,
        method: String,
        query: [String: String],
        body: Data?
    ) async throws -> Response {
        let session = try await sessions.validSession()
        let request = try makeRequest(
            session: session,
            path: path,
            method: method,
            query: query,
            body: body
        )

        let (data, status) = try await perform(request)

        if status == 401 {
            // The token looked live by its own expiry but the server refused it.
            // Refresh once and retry; a second refusal is real.
            let refreshed = try await sessions.validSession(force: true)
            let retry = try makeRequest(
                session: refreshed,
                path: path,
                method: method,
                query: query,
                body: body
            )
            let (retryData, retryStatus) = try await perform(retry)
            guard retryStatus != 401 else { throw OpsError.signedOut }
            return try decode(retryData, status: retryStatus)
        }

        return try decode(data, status: status)
    }

    private func makeRequest(
        session: StoredSession,
        path: String,
        method: String,
        query: [String: String],
        body: Data?
    ) throws -> URLRequest {
        guard
            var components = URLComponents(
                url: session.instance.appendingPathComponent("api/ops/mobile/\(path)"),
                resolvingAgainstBaseURL: false
            )
        else {
            throw OpsError.transport("The instance address is not usable.")
        }
        if !query.isEmpty {
            components.queryItems = query
                .sorted { $0.key < $1.key }
                .map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else {
            throw OpsError.transport("The instance address is not usable.")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.timeoutInterval = 20
        return request
    }

    private func perform(_ request: URLRequest) async throws -> (Data, Int) {
        do {
            let (data, response) = try await urlSession.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch let error as URLError {
            throw OpsError.transport(error.localizedDescription)
        } catch {
            throw OpsError.transport(error.localizedDescription)
        }
    }

    private func decode<Response: Decodable>(_ data: Data, status: Int) throws -> Response {
        guard (200..<300).contains(status) else {
            throw Self.error(status: status, data: data)
        }
        do {
            // A fresh decoder per response: JSONDecoder is a class and not
            // Sendable, so storing one would cost this client its Sendable
            // conformance for no measurable gain.
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw OpsError.decoding(error.localizedDescription)
        }
    }

    static func error(status: Int, data: Data) -> OpsError {
        struct Body: Decodable {
            let message: String?
            let opsModuleAvailable: Bool?
        }
        let body = try? JSONDecoder().decode(Body.self, from: data)
        let message = body?.message ?? "The request failed"

        switch status {
        case 401: return .signedOut
        case 403: return .noOpsAccess
        case 404: return .notFound
        case 503 where body?.opsModuleAvailable == false: return .opsModuleUnavailable(message)
        default: return .http(status: status, message: message)
        }
    }
}

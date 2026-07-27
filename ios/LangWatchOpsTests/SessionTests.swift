import XCTest

@testable import LangWatchOps

final class StoredSessionTests: XCTestCase {
    private func session(expiresIn seconds: TimeInterval) -> StoredSession {
        StoredSession(
            instance: URL(string: "https://app.langwatch.ai")!,
            accessToken: "lw_at_x",
            refreshToken: "lw_rt_x",
            accessTokenExpiresAt: Date().addingTimeInterval(seconds),
            userId: "user-1",
            userEmail: "operator@langwatch.ai",
            userName: "Operator",
            organizationName: "LangWatch"
        )
    }

    func testATokenWellInsideItsLifetimeIsNotExpired() {
        XCTAssertFalse(session(expiresIn: 3600).isExpired())
    }

    func testATokenPastItsExpiryIsExpired() {
        XCTAssertTrue(session(expiresIn: -1).isExpired())
    }

    func testATokenAboutToExpireCountsAsExpired() {
        // Inside the refresh margin: refresh now rather than let a request that
        // takes a moment to arrive carry a dead credential.
        XCTAssertTrue(session(expiresIn: 30).isExpired())
    }

    func testRenewingKeepsTheIdentityAndTheInstance() {
        let original = session(expiresIn: 10)
        let renewed = original.renewed(
            accessToken: "lw_at_new",
            refreshToken: "lw_rt_new",
            expiresAt: Date().addingTimeInterval(3600)
        )

        XCTAssertEqual(renewed.accessToken, "lw_at_new")
        XCTAssertEqual(renewed.refreshToken, "lw_rt_new")
        XCTAssertEqual(renewed.instance, original.instance)
        XCTAssertEqual(renewed.userId, original.userId)
        XCTAssertEqual(renewed.organizationName, original.organizationName)
        XCTAssertFalse(renewed.isExpired())
    }

    func testDisplayNamePrefersTheName() {
        XCTAssertEqual(session(expiresIn: 10).displayName, "Operator")
    }

    func testSurvivesARoundTripThroughTheKeychainEncoding() throws {
        let original = session(expiresIn: 3600)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(StoredSession.self, from: data)

        XCTAssertEqual(decoded, original)
    }
}

final class DeviceFlowFailureTests: XCTestCase {
    private func body(_ json: String) -> Data { Data(json.utf8) }

    func testPendingApprovalIsRecognisedSoTheLoopKeepsPolling() {
        let failure = DeviceFlowClient.failure(
            status: 428,
            data: body(#"{"error":"authorization_pending"}"#)
        )
        XCTAssertEqual(failure, .authorizationPending)
    }

    func testRateLimitingBecomesSlowDown() {
        let failure = DeviceFlowClient.failure(status: 429, data: body(#"{"error":"slow_down"}"#))
        XCTAssertEqual(failure, .slowDown)
    }

    func testAnExpiredDeviceCodeIsTerminal() {
        let failure = DeviceFlowClient.failure(status: 408, data: body(#"{"error":"expired_token"}"#))
        XCTAssertEqual(failure, .expired)
    }

    func testADeclinedRequestIsTerminal() {
        let failure = DeviceFlowClient.failure(status: 410, data: body(#"{"error":"access_denied"}"#))
        XCTAssertEqual(failure, .denied)
    }

    func testARevokedRefreshTokenIsRecognisedSoTheAppSignsOut() {
        let failure = DeviceFlowClient.failure(status: 401, data: body(#"{"error":"invalid_grant"}"#))
        XCTAssertEqual(failure, .refreshRejected)
    }

    func testAnUnrecognisedFailureKeepsTheServersOwnWording() {
        let failure = DeviceFlowClient.failure(
            status: 500,
            data: body(#"{"error":"server_error","error_description":"Unknown device code state"}"#)
        )
        XCTAssertEqual(failure, .server(status: 500, message: "Unknown device code state"))
    }

    func testABodylessFailureStillProducesAMessage() {
        let failure = DeviceFlowClient.failure(status: 502, data: Data())
        XCTAssertEqual(failure, .server(status: 502, message: "Sign-in failed"))
    }
}


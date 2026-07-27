import XCTest

@testable import LangWatchOps

final class OpsClientErrorTests: XCTestCase {
    private func body(_ json: String) -> Data { Data(json.utf8) }

    func testUnauthorizedBecomesSignedOut() {
        XCTAssertEqual(
            OpsClient.error(status: 401, data: body(#"{"message":"Unauthorized"}"#)),
            .signedOut
        )
    }

    func testForbiddenBecomesNoOpsAccess() {
        XCTAssertEqual(
            OpsClient.error(
                status: 403,
                data: body(#"{"message":"You do not have permission to access ops resources"}"#)
            ),
            .noOpsAccess
        )
    }

    func testAMissingOpsModuleIsDistinguishedFromAnOrdinaryOutage() {
        // A screen must be able to say "ops is not running here" rather than
        // offering a retry that can never succeed on this instance.
        let error = OpsClient.error(
            status: 503,
            data: body(#"{"message":"The ops module is not running on this instance","opsModuleAvailable":false}"#)
        )
        XCTAssertEqual(
            error,
            .opsModuleUnavailable("The ops module is not running on this instance")
        )
    }

    func testAPlainServiceUnavailableStaysAnHttpError() {
        let error = OpsClient.error(status: 503, data: body(#"{"message":"upstream down"}"#))
        XCTAssertEqual(error, .http(status: 503, message: "upstream down"))
    }

    func testNotFoundIsItsOwnCase() {
        XCTAssertEqual(
            OpsClient.error(status: 404, data: body(#"{"message":"Group not found"}"#)),
            .notFound
        )
    }

    func testABadRequestKeepsTheServersMessage() {
        let error = OpsClient.error(
            status: 400,
            data: body(#"{"message":"This action needs to be confirmed before it can run"}"#)
        )
        XCTAssertEqual(
            error,
            .http(status: 400, message: "This action needs to be confirmed before it can run")
        )
    }

    func testAnUnparseableBodyStillProducesAMessage() {
        let error = OpsClient.error(status: 500, data: Data("<html>".utf8))
        XCTAssertEqual(error, .http(status: 500, message: "The request failed"))
    }

    func testOnlyRecoverableFailuresOfferARetry() {
        XCTAssertTrue(OpsError.transport("offline").isRetryable)
        XCTAssertTrue(OpsError.http(status: 500, message: "boom").isRetryable)
        XCTAssertTrue(OpsError.opsModuleUnavailable("not running").isRetryable)

        // A retry button on either of these is a button that cannot help.
        XCTAssertFalse(OpsError.noOpsAccess.isRetryable)
        XCTAssertFalse(OpsError.signedOut.isRetryable)
    }
}

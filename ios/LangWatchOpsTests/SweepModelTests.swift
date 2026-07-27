import XCTest

@testable import LangWatchOps

@MainActor
final class SweepModelTests: XCTestCase {
    private func model() -> SweepModel {
        // The client is never reached: every assertion here is about the
        // confirmation gate, which has to hold before any request is made.
        SweepModel(
            client: OpsClient(
                sessions: SessionStore(
                    keychain: Keychain(service: "ai.langwatch.ops.tests"),
                    deviceFlow: DeviceFlowClient()
                )
            )
        )
    }

    func testTheReclaimIsNotConfirmedUntilTheWordIsTyped() {
        let sweep = model()
        XCTAssertFalse(sweep.isConfirmed)
    }

    func testAPartialWordDoesNotConfirm() {
        let sweep = model()
        sweep.confirmationText = "RECLAI"
        XCTAssertFalse(sweep.isConfirmed)
    }

    func testTheWrongCaseDoesNotConfirm() {
        // Half the value of a typed confirmation is that it cannot be produced
        // by a thumb brushing the screen; a forgiving comparison gives that up.
        let sweep = model()
        sweep.confirmationText = "reclaim"
        XCTAssertFalse(sweep.isConfirmed)
    }

    func testSurroundingWhitespaceDoesNotConfirm() {
        let sweep = model()
        sweep.confirmationText = " RECLAIM "
        XCTAssertFalse(sweep.isConfirmed)
    }

    func testTheExactWordConfirms() {
        let sweep = model()
        sweep.confirmationText = sweepConfirmationWord
        XCTAssertTrue(sweep.isConfirmed)
    }

    func testAskingForARealSweepWithoutConfirmingDoesNothing() {
        let sweep = model()
        sweep.confirmationText = "nope"

        sweep.runForReal()

        XCTAssertFalse(sweep.isRunning)
        XCTAssertEqual(sweep.phase, .ready)
    }

    func testStartingOverClearsTheTypedConfirmation() {
        let sweep = model()
        sweep.confirmationText = sweepConfirmationWord

        sweep.startOver()

        XCTAssertEqual(sweep.confirmationText, "")
        XCTAssertFalse(sweep.isConfirmed)
    }
}

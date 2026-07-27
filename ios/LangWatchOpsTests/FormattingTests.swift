import XCTest

@testable import LangWatchOps

final class FormattingTests: XCTestCase {
    func testSmallCountsAreWrittenOut() {
        XCTAssertEqual(Format.count(0), "0")
        XCTAssertEqual(Format.count(999), "999")
    }

    func testLargerCountsAreAbbreviated() {
        XCTAssertEqual(Format.count(1_000), "1k")
        XCTAssertEqual(Format.count(1_200), "1.2k")
        XCTAssertEqual(Format.count(1_234_567), "1.2M")
        XCTAssertEqual(Format.count(3_000_000_000), "3B")
    }

    func testNegativeCountsKeepTheirSign() {
        // Counter drift is signed: over-counted and under-counted are different
        // problems, and losing the sign would hide which one this is.
        XCTAssertEqual(Format.count(-42), "-42")
    }

    func testLowRatesKeepADecimalPlace() {
        XCTAssertEqual(Format.rate(0), "0")
        XCTAssertEqual(Format.rate(1.26), "1.3")
        XCTAssertEqual(Format.rate(9.94), "9.9")
    }

    func testHighRatesAreAbbreviatedLikeCounts() {
        XCTAssertEqual(Format.rate(1500), "1.5k")
    }

    func testSubMillisecondLatencyDoesNotReadAsZero() {
        XCTAssertEqual(Format.milliseconds(0.4), "<1ms")
    }

    func testLatencyCrossesIntoSeconds() {
        XCTAssertEqual(Format.milliseconds(250), "250ms")
        XCTAssertEqual(Format.milliseconds(1_500), "1.5s")
    }

    func testDurationsUseTheUnitAnOperatorWouldSay() {
        XCTAssertEqual(Format.duration(seconds: 42), "42s")
        XCTAssertEqual(Format.duration(seconds: 300), "5m")
        XCTAssertEqual(Format.duration(seconds: 7_200), "2h")
        XCTAssertEqual(Format.duration(seconds: 172_800), "2d")
    }

    func testAFreshTimestampReadsAsJustNow() {
        XCTAssertEqual(Format.relative(Date(), now: Date()), "just now")
    }

    func testAnOlderTimestampReadsAsAnAge() {
        let now = Date()
        XCTAssertEqual(Format.relative(now.addingTimeInterval(-600), now: now), "10m ago")
    }

    func testParsesBothISOFormsTheServerSends() {
        XCTAssertNotNil(Format.date(fromISO: "2026-01-02T03:04:05.000Z"))
        XCTAssertNotNil(Format.date(fromISO: "2026-01-02T03:04:05Z"))
    }

    func testAnUnparseableTimestampFallsBackToTheServersText() {
        // Better to show whatever the instance sent than to render "—" and lose
        // the only information there was.
        XCTAssertEqual(Format.shortDateTime(fromISO: "not a date"), "not a date")
    }
}

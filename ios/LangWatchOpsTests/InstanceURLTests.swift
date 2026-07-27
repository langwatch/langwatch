import XCTest

@testable import LangWatchOps

final class InstanceURLTests: XCTestCase {
    func testAddsHttpsWhenTheSchemeIsOmitted() {
        XCTAssertEqual(
            InstanceURL.parse("app.langwatch.ai")?.absoluteString,
            "https://app.langwatch.ai"
        )
    }

    func testKeepsAnExplicitScheme() {
        XCTAssertEqual(
            InstanceURL.parse("http://localhost:5560")?.absoluteString,
            "http://localhost:5560"
        )
    }

    func testStripsThePathFromAPastedDeepLink() {
        XCTAssertEqual(
            InstanceURL.parse("https://app.langwatch.ai/ops/queues?queue=x#frag")?.absoluteString,
            "https://app.langwatch.ai"
        )
    }

    func testTrimsSurroundingWhitespace() {
        XCTAssertEqual(
            InstanceURL.parse("  app.langwatch.ai \n")?.absoluteString,
            "https://app.langwatch.ai"
        )
    }

    func testRejectsEmptyInput() {
        XCTAssertNil(InstanceURL.parse(""))
        XCTAssertNil(InstanceURL.parse("   "))
    }

    func testRejectsAHostWithoutADot() {
        // Guards against a half-typed address being accepted and then failing
        // with a confusing network error instead of an obvious one.
        XCTAssertNil(InstanceURL.parse("applangwatch"))
    }

    func testAcceptsLocalhostWithoutADot() {
        XCTAssertNotNil(InstanceURL.parse("localhost:5560"))
    }

    func testRejectsANonHttpScheme() {
        XCTAssertNil(InstanceURL.parse("ftp://app.langwatch.ai"))
        XCTAssertNil(InstanceURL.parse("javascript:alert(1)"))
    }

    func testDisplayNameDropsTheScheme() {
        let url = URL(string: "https://app.langwatch.ai")!
        XCTAssertEqual(InstanceURL.displayName(url), "app.langwatch.ai")
    }

    func testDisplayNameKeepsANonDefaultPort() {
        let url = URL(string: "http://localhost:5560")!
        XCTAssertEqual(InstanceURL.displayName(url), "localhost:5560")
    }
}

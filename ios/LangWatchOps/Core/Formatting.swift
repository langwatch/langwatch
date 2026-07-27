import Foundation

/// Shared number and date formatting.
///
/// Ops numbers get abbreviated hard — a phone screen has room for "1.2M", not
/// "1,234,567", and an operator scanning for an order of magnitude is better
/// served by the short form anyway.
enum Format {
    static func count(_ value: Int) -> String {
        let magnitude = abs(value)
        switch magnitude {
        case 0..<1_000:
            return String(value)
        case 1_000..<1_000_000:
            return trimmed(Double(value) / 1_000, suffix: "k")
        case 1_000_000..<1_000_000_000:
            return trimmed(Double(value) / 1_000_000, suffix: "M")
        default:
            return trimmed(Double(value) / 1_000_000_000, suffix: "B")
        }
    }

    static func rate(_ value: Double) -> String {
        if value == 0 { return "0" }
        if value < 10 { return String(format: "%.1f", value) }
        return count(Int(value.rounded()))
    }

    static func percent(_ value: Double) -> String {
        String(format: "%.0f%%", value)
    }

    static func bytes(_ value: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        formatter.allowedUnits = [.useKB, .useMB, .useGB, .useTB]
        return formatter.string(fromByteCount: Int64(value))
    }

    static func milliseconds(_ value: Double) -> String {
        if value < 1 { return "<1ms" }
        if value < 1_000 { return "\(Int(value.rounded()))ms" }
        return String(format: "%.1fs", value / 1_000)
    }

    /// A duration written the way an operator says it out loud: "4m", "3h",
    /// "2d". Nil input means the server had nothing to report, not zero.
    static func duration(seconds: Double) -> String {
        let value = abs(seconds)
        switch value {
        case 0..<60:
            return "\(Int(value.rounded()))s"
        case 60..<3_600:
            return "\(Int(value / 60))m"
        case 3_600..<86_400:
            return "\(Int(value / 3_600))h"
        default:
            return "\(Int(value / 86_400))d"
        }
    }

    /// "4m ago", or "just now" inside the first few seconds so a fresh screen
    /// does not flicker "0s ago".
    static func relative(_ date: Date, now: Date = Date()) -> String {
        let elapsed = now.timeIntervalSince(date)
        if elapsed < 5 { return "just now" }
        if elapsed < 0 { return "in \(duration(seconds: -elapsed))" }
        return "\(duration(seconds: elapsed)) ago"
    }

    /// Parse an ISO-8601 timestamp from the server. It sends both plain
    /// (`2026-01-02T03:04:05.000Z`) and fractionless forms depending on the
    /// source, so both are tried.
    static func date(fromISO string: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: string) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: string)
    }

    static func shortDateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Same, straight from an ISO string, falling back to the raw string when it
    /// cannot be parsed — better to show the server's own text than "—".
    static func shortDateTime(fromISO string: String) -> String {
        guard let date = date(fromISO: string) else { return string }
        return shortDateTime(date)
    }

    private static func trimmed(_ value: Double, suffix: String) -> String {
        let rounded = (value * 10).rounded() / 10
        if rounded == rounded.rounded() {
            return "\(Int(rounded))\(suffix)"
        }
        return String(format: "%.1f%@", rounded, suffix)
    }
}

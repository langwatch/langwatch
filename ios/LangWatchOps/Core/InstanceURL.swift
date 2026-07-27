import Foundation

/// Turns whatever an operator types into the instance base URL.
///
/// They will type `app.langwatch.ai`, or paste
/// `https://app.langwatch.ai/ops/queues` out of a browser, or type a hostname
/// with a trailing slash. All three mean the same instance, and asking someone
/// to type a scheme correctly on a phone keyboard is a needless way to fail a
/// sign-in.
enum InstanceURL {
    static let production = URL(string: "https://app.langwatch.ai")!

    static func parse(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // Default to https. Plain http is still accepted when typed explicitly,
        // for a developer pointing at a local instance — App Transport Security
        // still refuses it for anything but the local network.
        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"

        guard
            var components = URLComponents(string: withScheme),
            let scheme = components.scheme?.lowercased(),
            scheme == "https" || scheme == "http",
            let host = components.host,
            !host.isEmpty,
            host.contains(".") || host == "localhost"
        else {
            return nil
        }

        // Keep only the origin: a pasted deep link carries a path this app must
        // not treat as an API prefix.
        components.path = ""
        components.query = nil
        components.fragment = nil

        return components.url
    }

    /// How an instance is written on screen: the host, without the scheme noise.
    static func displayName(_ url: URL) -> String {
        guard let host = url.host else { return url.absoluteString }
        if let port = url.port { return "\(host):\(port)" }
        return host
    }
}

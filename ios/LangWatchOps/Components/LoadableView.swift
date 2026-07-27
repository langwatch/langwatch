import SwiftUI

/// Renders one screen's four states so no screen has to reinvent them.
///
/// The failure branch distinguishes a retryable problem from a terminal one: a
/// network blip gets a retry button, "this account has no ops access" does not,
/// because a button that cannot help is worse than none.
struct LoadableView<Value, Content: View>: View {
    let state: Loadable<Value>
    let retry: () -> Void
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        switch state {
        case .idle, .loading:
            ProgressView()
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 40)
                .listRowSeparator(.hidden)
        case let .loaded(value):
            content(value)
        case let .failed(error):
            ErrorStateView(error: error, retry: retry)
                .listRowSeparator(.hidden)
        }
    }
}

struct ErrorStateView: View {
    let error: Error
    let retry: () -> Void

    private var opsError: OpsError? { error as? OpsError }

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(error.localizedDescription)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if opsError?.isRetryable ?? true {
                Button("Try again", action: retry)
                    .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
    }

    private var title: String {
        guard let opsError else { return "Could not load" }
        switch opsError {
        case .noOpsAccess: return "No ops access"
        case .opsModuleUnavailable: return "Ops is not running here"
        case .notFound: return "Not found"
        case .signedOut: return "Signed out"
        case .http, .transport, .decoding: return "Could not load"
        }
    }

    private var symbol: String {
        guard let opsError else { return "wifi.exclamationmark" }
        switch opsError {
        case .noOpsAccess, .signedOut: return "lock"
        case .opsModuleUnavailable: return "powerplug"
        case .notFound: return "questionmark.circle"
        case .http, .transport, .decoding: return "wifi.exclamationmark"
        }
    }
}

/// The banner a screen shows when a background refresh failed but earlier
/// figures are still on screen.
struct StaleDataBanner: View {
    let lastLoadedAt: Date?
    let failure: Error?

    var body: some View {
        if let failure {
            Label(
                "Not updating — \(failure.localizedDescription)",
                systemImage: "exclamationmark.triangle"
            )
            .font(.caption)
            .foregroundStyle(.orange)
        } else if let lastLoadedAt, Date().timeIntervalSince(lastLoadedAt) > 60 {
            Label(
                "Figures from \(Format.relative(lastLoadedAt))",
                systemImage: "clock"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}

struct EmptyStateRow: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 12)
    }
}

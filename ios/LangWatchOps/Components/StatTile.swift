import SwiftUI

/// Severity drives colour everywhere in the app, so "red" always means the same
/// thing: something needs an operator, not merely that a number is large.
enum StatSeverity {
    case normal
    case warning
    case critical

    var tint: Color {
        switch self {
        case .normal: return .primary
        case .warning: return .orange
        case .critical: return .red
        }
    }

    /// Colour is never the only channel — VoiceOver and colour-blind operators
    /// get the same signal from the label.
    var accessibilityNote: String? {
        switch self {
        case .normal: return nil
        case .warning: return "needs attention"
        case .critical: return "critical"
        }
    }
}

struct StatTile: View {
    let title: String
    let value: String
    var caption: String?
    var severity: StatSeverity = .normal

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(value)
                .font(.title3.weight(.semibold))
                .foregroundStyle(severity.tint)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let caption {
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        [title, value, caption, severity.accessibilityNote]
            .compactMap { $0 }
            .joined(separator: ", ")
    }
}

/// Two-column tile grid. Two, not adaptive: three tiles across on a phone makes
/// every number truncate, and these numbers are the point of the screen.
struct StatGrid<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
            spacing: 10
        ) {
            content
        }
    }
}

/// A labelled row of the "key: value" kind that detail screens are made of.
struct DetailRow: View {
    let label: String
    let value: String
    var isMonospaced: Bool = false

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value)
                .font(isMonospaced ? .body.monospaced() : .body)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .font(.subheadline)
    }
}

/// A short status word — "blocked", "hard", "running" — rendered as a pill.
struct StatusPill: View {
    let text: String
    var severity: StatSeverity = .normal

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(severity.tint.opacity(0.15), in: Capsule())
            .foregroundStyle(severity.tint)
    }
}

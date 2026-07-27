import SwiftUI

/// The Foundry, as a catalog.
///
/// On the web the Foundry is a workbench: it builds a synthetic trace and emits
/// it into a project. Emitting telemetry from a phone into a live project is not
/// something anyone wants to do by accident on a train, so here it is
/// read-only — the presets and the span trees they would produce, and nothing
/// that sends.
struct FoundryView: View {
    @StateObject private var loader: Loader<[FoundryPreset]>

    init(client: OpsClient) {
        _loader = StateObject(wrappedValue: Loader { try await client.foundryPresets() })
    }

    var body: some View {
        List {
            Section {
                LoadableView(state: loader.state, retry: { loader.reload() }) { presets in
                    if presets.isEmpty {
                        EmptyStateRow(message: "No presets are registered.")
                    } else {
                        ForEach(presets) { preset in
                            NavigationLink {
                                FoundryPresetDetailView(preset: preset)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(preset.name).font(.subheadline.weight(.medium))
                                    Text(preset.description)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                    Text("\(preset.spanCount) spans")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                }
            } header: {
                Text("Presets")
            } footer: {
                Text("Generating a trace from a preset happens in the web console.")
            }
        }
        .navigationTitle("The Foundry")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await loader.refresh() }
        .task { loader.loadIfNeeded() }
    }
}

/// A span flattened out of the tree for display, carrying its depth and an
/// identity taken from its position — sibling spans can share a name, so nothing
/// derived from the contents would be unique.
private struct FlatSpan: Identifiable {
    let id: String
    let depth: Int
    let span: FoundrySpan

    static func flatten(_ spans: [FoundrySpan], depth: Int = 0, prefix: String = "") -> [FlatSpan] {
        var flattened: [FlatSpan] = []
        for (index, span) in spans.enumerated() {
            let path = prefix.isEmpty ? String(index) : "\(prefix).\(index)"
            flattened.append(FlatSpan(id: path, depth: depth, span: span))
            flattened.append(contentsOf: flatten(span.children, depth: depth + 1, prefix: path))
        }
        return flattened
    }
}

struct FoundryPresetDetailView: View {
    let preset: FoundryPreset

    private var flattened: [FlatSpan] { FlatSpan.flatten(preset.spans) }

    var body: some View {
        List {
            Section("Preset") {
                Text(preset.description)
                    .font(.callout)
                DetailRow(label: "Spans", value: String(preset.spanCount))
                if let serviceName = preset.serviceName {
                    DetailRow(label: "Service name", value: serviceName, isMonospaced: true)
                }
            }

            Section {
                ForEach(flattened) { entry in
                    HStack(spacing: 8) {
                        // Indentation carries the tree structure; the depth also
                        // goes into the accessibility label so it survives for
                        // anyone not seeing the layout.
                        if entry.depth > 0 {
                            Rectangle()
                                .fill(Color.secondary.opacity(0.3))
                                .frame(width: 1)
                                .padding(.leading, CGFloat(entry.depth - 1) * 12)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(entry.span.name)
                                    .font(.caption.monospaced())
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Spacer(minLength: 8)
                                Text(Format.milliseconds(entry.span.durationMs))
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            HStack(spacing: 6) {
                                Text(entry.span.type)
                                if let model = entry.span.model {
                                    Text("· \(model)")
                                }
                                if entry.span.status == "error" {
                                    Text("· error").foregroundStyle(.red)
                                }
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(
                        "Depth \(entry.depth + 1), \(entry.span.name), \(entry.span.type), \(Format.milliseconds(entry.span.durationMs))"
                    )
                }
            } header: {
                Text("Span tree")
            }
        }
        .navigationTitle(preset.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

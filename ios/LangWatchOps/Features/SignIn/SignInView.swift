import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var app: AppModel
    @StateObject private var flow: DeviceFlowController
    @Environment(\.openURL) private var openURL

    @AppStorage("instanceURLText") private var instanceText = "app.langwatch.ai"

    init(controller: DeviceFlowController) {
        _flow = StateObject(wrappedValue: controller)
    }

    private var instance: URL? { InstanceURL.parse(instanceText) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("app.langwatch.ai", text: $instanceText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .disabled(flow.challenge != nil)
                } header: {
                    Text("LangWatch instance")
                } footer: {
                    Text("The address you open LangWatch at. Self-hosted instances work too.")
                }

                switch flow.state {
                case .idle, .failed:
                    signInSection
                case .requestingCode:
                    Section {
                        HStack {
                            ProgressView()
                            Text("Starting sign-in…").foregroundStyle(.secondary)
                        }
                    }
                case let .awaitingApproval(challenge):
                    approvalSection(challenge)
                case .succeeded:
                    Section {
                        Label("Signed in", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                }

                if case let .failed(message) = flow.state {
                    Section {
                        Label(message, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle("LangWatch Ops")
            .onChange(of: flow.state) { state in
                guard case let .succeeded(session) = state else { return }
                Task { await app.completeSignIn(with: session) }
            }
        }
    }

    private var signInSection: some View {
        Section {
            Button {
                guard let instance else { return }
                flow.start(instance: instance)
            } label: {
                Text("Sign in")
                    .frame(maxWidth: .infinity)
            }
            .disabled(instance == nil)
        } footer: {
            Text("Approval happens in your browser, so single sign-on and two-factor stay in force.")
        }
    }

    private func approvalSection(_ challenge: DeviceFlowClient.Challenge) -> some View {
        Section {
            VStack(spacing: 12) {
                Text("Confirm this code in the browser")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(challenge.userCode)
                    .font(.system(.largeTitle, design: .monospaced).weight(.semibold))
                    .textSelection(.enabled)
                    .accessibilityLabel(spelledOut(challenge.userCode))
                Button("Open browser") {
                    openURL(challenge.verificationURL)
                }
                .buttonStyle(.borderedProminent)
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("Waiting for approval…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)

            Button("Cancel", role: .cancel) { flow.cancel() }
        }
        // The browser opens itself the first time; the button is there for the
        // operator who dismissed it or switched apps and came back.
        .task(id: challenge.deviceCode) {
            openURL(challenge.verificationURL)
        }
    }

    /// "W, D, J, B, dash, M, J, H, T" — VoiceOver reads an unspaced code as a
    /// mangled word otherwise, and this code has to be matched by eye.
    private func spelledOut(_ code: String) -> String {
        code.map { $0 == "-" ? "dash" : String($0) }.joined(separator: ", ")
    }
}

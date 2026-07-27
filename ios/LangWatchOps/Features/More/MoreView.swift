import SwiftUI

/// Everything that is browsed rather than watched.
struct MoreView: View {
    private let client: OpsClient

    init(client: OpsClient) {
        self.client = client
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        SchedulerView(client: client)
                    } label: {
                        Label("Scheduler", systemImage: "calendar.badge.clock")
                    }
                    NavigationLink {
                        FoundryView(client: client)
                    } label: {
                        Label("The Foundry", systemImage: "hammer")
                    }
                    NavigationLink {
                        ProjectionsView(client: client)
                    } label: {
                        Label("Projection replay", systemImage: "film")
                    }
                }

                Section {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Label("Settings", systemImage: "gearshape")
                    }
                }
            }
            .navigationTitle("More")
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var app: AppModel
    @State private var confirmingSignOut = false

    var body: some View {
        List {
            if let session = app.session {
                Section("Signed in") {
                    DetailRow(label: "Account", value: session.displayName)
                    if let email = session.userEmail, email != session.displayName {
                        DetailRow(label: "Email", value: email)
                    }
                    if let organization = session.organizationName {
                        DetailRow(label: "Organization", value: organization)
                    }
                    DetailRow(label: "Instance", value: InstanceURL.displayName(session.instance))
                    if !app.opsModuleAvailable {
                        // Worth saying once here rather than letting every
                        // screen discover it separately: on an instance running
                        // without the ops module, nothing in this app has data
                        // to show and that is not a fault worth chasing.
                        Label(
                            "This instance is running without the ops module.",
                            systemImage: "powerplug"
                        )
                        .font(.footnote)
                        .foregroundStyle(.orange)
                    }
                }
            }

            Section {
                Button(role: .destructive) {
                    confirmingSignOut = true
                } label: {
                    Text("Sign out")
                }
            } footer: {
                Text("Signing out removes the stored credential from this device. It does not revoke other devices.")
            }

            Section {
                Text("This app monitors. Unblocking queues, redriving dead letters, pausing tenants, flipping feature flags and starting projection replays all stay in the web console.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } header: {
                Text("What this app can do")
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            "Sign out of LangWatch Ops?",
            isPresented: $confirmingSignOut,
            titleVisibility: .visible
        ) {
            Button("Sign out", role: .destructive) {
                Task { await app.signOut() }
            }
            Button("Cancel", role: .cancel) {}
        }
    }
}

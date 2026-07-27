import SwiftUI

struct RootView: View {
    @EnvironmentObject private var app: AppModel

    var body: some View {
        switch app.phase {
        case .restoring:
            ProgressView()
        case .signedOut:
            SignInView(controller: app.newDeviceFlowController())
        case .ready:
            MainTabView()
        case let .noOpsAccess(email):
            NoOpsAccessView(email: email)
        }
    }
}

/// Five tabs, matching the ops side menu on the web: the dashboard, the queues,
/// what is broken, the payload store, and everything that is browsed rather than
/// watched.
struct MainTabView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView {
            DashboardView(client: app.client)
                .tabItem { Label("Overview", systemImage: "gauge.with.dots.needle.33percent") }

            QueuesView(client: app.client)
                .tabItem { Label("Queues", systemImage: "square.stack.3d.up") }

            HealthView(client: app.client)
                .tabItem { Label("Health", systemImage: "heart.text.square") }
                .badge(app.badge?.total ?? 0)

            PayloadStoreView(client: app.client)
                .tabItem { Label("Storage", systemImage: "internaldrive") }

            MoreView(client: app.client)
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
        .task { await app.refreshBadge() }
        .onChange(of: scenePhase) { phase in
            // Only refresh when the app comes forward. Polling a badge for a
            // screen nobody is looking at spends the operator's battery on
            // nothing.
            guard phase == .active else { return }
            Task { await app.refreshBadge() }
        }
    }
}

struct NoOpsAccessView: View {
    @EnvironmentObject private var app: AppModel
    let email: String?

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.shield")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("No ops access")
                .font(.title2.weight(.semibold))
            Text(explanation)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Sign out") {
                Task { await app.signOut() }
            }
            .buttonStyle(.bordered)
        }
        .padding(32)
    }

    private var explanation: String {
        if let email {
            return "\(email) is signed in, but it is not a platform operator on this instance. Sign in with an operator account to continue."
        }
        return "This account is not a platform operator on this instance."
    }
}

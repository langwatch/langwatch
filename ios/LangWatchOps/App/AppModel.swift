import Foundation
import SwiftUI

/// Where the app is in its own lifecycle. Everything the root view branches on.
enum AppPhase: Equatable {
    /// Reading the keychain — a brief state, but rendering the sign-in screen
    /// during it would flash it at an operator who is already signed in.
    case restoring
    case signedOut
    /// Signed in and confirmed to hold ops access.
    case ready
    /// Signed in, but this account is not a platform operator. A distinct state
    /// from `signedOut` because the fix is different: sign in as someone else,
    /// not sign in again.
    case noOpsAccess(email: String?)
}

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var phase: AppPhase = .restoring
    @Published private(set) var session: StoredSession?
    @Published private(set) var badge: BadgeCounts?
    /// True when the instance answers that it is running without the ops module.
    @Published private(set) var opsModuleAvailable = true

    let client: OpsClient
    private let sessions: SessionStore
    private let deviceFlow: DeviceFlowClient

    init(
        keychain: Keychain = Keychain(service: "ai.langwatch.ops"),
        deviceFlow: DeviceFlowClient = DeviceFlowClient()
    ) {
        let store = SessionStore(keychain: keychain, deviceFlow: deviceFlow)
        self.sessions = store
        self.deviceFlow = deviceFlow
        self.client = OpsClient(sessions: store)
    }

    // MARK: - Lifecycle

    func restore() async {
        guard let stored = await sessions.current() else {
            phase = .signedOut
            return
        }
        session = stored
        await confirmScope()
    }

    /// Ask the instance what this account can see.
    ///
    /// The scope probe answers 200 with `hasOpsAccess: false` rather than 403,
    /// so an account without ops access lands on an explanation instead of an
    /// error screen it cannot act on.
    func confirmScope() async {
        do {
            let scope = try await client.scope()
            opsModuleAvailable = scope.opsModuleAvailable
            phase = scope.hasOpsAccess ? .ready : .noOpsAccess(email: scope.email)
        } catch OpsError.signedOut {
            await signOut()
        } catch {
            // A network failure at launch must not throw away a good session —
            // the operator may be on a train. Go through to the app; each screen
            // reports its own failure and offers a retry.
            phase = .ready
        }
    }

    func completeSignIn(with session: StoredSession) async {
        do {
            try await sessions.store(session)
        } catch {
            // The keychain refused to persist. The session still works for this
            // launch, so carry on rather than blocking the operator; the next
            // launch will simply ask them to sign in again.
        }
        self.session = session
        await confirmScope()
    }

    func signOut() async {
        await sessions.clear()
        session = nil
        badge = nil
        phase = .signedOut
    }

    // MARK: - Badge

    /// The blocked + dead-lettered count on the tab bar. Cheap enough to poll:
    /// the server memoizes it separately from the full dashboard aggregation.
    func refreshBadge() async {
        badge = try? await client.badgeCounts()
    }

    func newDeviceFlowController() -> DeviceFlowController {
        DeviceFlowController(deviceFlow: deviceFlow)
    }
}

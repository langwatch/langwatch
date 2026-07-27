import Foundation

/// Drives one sign-in attempt: ask for a code, then poll until the operator
/// approves it in the browser.
@MainActor
final class DeviceFlowController: ObservableObject {
    enum State: Equatable {
        case idle
        case requestingCode
        /// Waiting for the operator to approve in the browser.
        case awaitingApproval(DeviceFlowClient.Challenge)
        case succeeded(StoredSession)
        case failed(String)
    }

    @Published private(set) var state: State = .idle

    private let deviceFlow: DeviceFlowClient
    private var pollTask: Task<Void, Never>?

    init(deviceFlow: DeviceFlowClient) {
        self.deviceFlow = deviceFlow
    }

    var challenge: DeviceFlowClient.Challenge? {
        if case let .awaitingApproval(challenge) = state { return challenge }
        return nil
    }

    func start(instance: URL) {
        cancel()
        state = .requestingCode
        pollTask = Task { [weak self] in
            await self?.run(instance: instance)
        }
    }

    func cancel() {
        pollTask?.cancel()
        pollTask = nil
        state = .idle
    }

    private func run(instance: URL) async {
        do {
            let challenge = try await deviceFlow.requestDeviceCode(instance: instance)
            guard !Task.isCancelled else { return }
            state = .awaitingApproval(challenge)
            try await poll(challenge: challenge, instance: instance)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            state = .failed(error.localizedDescription)
        }
    }

    private func poll(challenge: DeviceFlowClient.Challenge, instance: URL) async throws {
        // Start at the server's advertised interval and back off on `slow_down`,
        // which is what RFC 8628 asks of a client and what the server's own
        // rate limiter enforces anyway.
        var interval = challenge.pollInterval

        while !Task.isCancelled {
            if Date() >= challenge.expiresAt {
                state = .failed(DeviceFlowClient.Failure.expired.localizedDescription)
                return
            }

            try await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            guard !Task.isCancelled else { return }

            do {
                let session = try await deviceFlow.exchange(
                    deviceCode: challenge.deviceCode,
                    instance: instance
                )
                state = .succeeded(session)
                return
            } catch DeviceFlowClient.Failure.authorizationPending {
                continue
            } catch DeviceFlowClient.Failure.slowDown {
                interval += 2
                continue
            } catch let failure as DeviceFlowClient.Failure {
                state = .failed(failure.localizedDescription)
                return
            }
        }
    }
}

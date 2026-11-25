// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** What a locked body is handed: `signal` aborts before the lock can lapse under it. */
export type KillSwitchLockHold = { signal: AbortSignal };

/** Serialises kill switch work on one key (a shared virtual key, one agent's plan and stop). */
export abstract class KillSwitchLockRepository {
  abstract withLock<T>(input: {
    key: string;
    run: (hold: KillSwitchLockHold) => Promise<T>;
  }): Promise<T>;
}

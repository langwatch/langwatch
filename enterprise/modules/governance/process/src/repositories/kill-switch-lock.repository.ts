// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** Serialises kill switch work on one key (a shared virtual key, one agent's plan). */
export abstract class KillSwitchLockRepository {
  abstract withLock<T>(input: { key: string; run: () => Promise<T> }): Promise<T>;
}

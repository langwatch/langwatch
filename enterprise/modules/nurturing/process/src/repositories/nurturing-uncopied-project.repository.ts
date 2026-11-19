// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Nurturing's own record (`NurturingUncopiedProject`) of when it first saw a project's traces
 * with no placement copy, shared by every worker and kept across restarts, so the retry window
 * runs once per project. Forgotten when the project's copy lands.
 */
export interface NurturingUncopiedProjectRepository {
  /** When the project was first seen uncopied, epoch ms; the first ask records `seenAt`, and a concurrent one keeps it. */
  firstSeenAt(input: Readonly<{ projectId: string; seenAt: number }>): Promise<number>;
  /** The project's copy landed: a later uncopied sighting starts afresh. */
  forget(input: Readonly<{ projectId: string }>): Promise<void>;
}

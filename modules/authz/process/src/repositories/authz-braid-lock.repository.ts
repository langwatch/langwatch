/**
 * ADR-185 §1: every braid write into one reader runs one at a time, so the live-row checks
 * (identical braid, distinct-condition limit, the braid a change names) hold for its write.
 */
export abstract class AuthzBraidLockRepository {
  abstract withReaderLock<T>(input: {
    readerProjectId: string;
    write: () => Promise<T>;
  }): Promise<T>;
}

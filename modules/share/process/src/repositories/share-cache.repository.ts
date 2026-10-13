export interface ShareCacheRepository {
  isNewViewing: (input: { shareId: string; viewerKey: string }) => Promise<boolean>;

  findPayload: (key: string) => Promise<unknown>;
  setPayload: (key: string, payload: unknown) => Promise<void>;
}

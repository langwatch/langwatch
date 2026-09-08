export interface ShareCacheRepository {
  isNewViewing(input: { shareId: string; viewerKey: string }): Promise<boolean>;

  findPayload(key: string): Promise<unknown | null>;
  setPayload(key: string, payload: unknown): Promise<void>;
}

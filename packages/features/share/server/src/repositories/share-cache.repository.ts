export abstract class ShareCacheRepository {
  abstract isNewViewing(input: { shareId: string; viewerKey: string }): Promise<boolean>;

  abstract tryGetPayload(key: string): Promise<unknown | null>;
  abstract setPayload(key: string, payload: unknown): Promise<void>;
}

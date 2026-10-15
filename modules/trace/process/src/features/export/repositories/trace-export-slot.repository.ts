/** The export door's in-flight slots: a claim holds a key until freed or until it expires. */
export abstract class TraceExportSlotRepository {
  /** Claims the key for `expirySeconds` when it is free; false when already held. */
  abstract claim(key: string, value: string, expirySeconds: number): Promise<boolean>;

  abstract del(key: string): Promise<number>;
}

import {
  StoredObjectCapabilityUnavailableError,
  type StoredObjectDeliveryAudience,
  type StoredObjectDeliveryCapability,
  type StoredObjectId,
  type StoredObjectProjectId,
} from "@langwatch/stored-object-contract";

/** Mints a delivery capability: a URL a reader fetches one object's bytes from. */
export abstract class StoredObjectDelivery {
  abstract mint(input: {
    projectId: StoredObjectProjectId;
    id: StoredObjectId;
    audience: StoredObjectDeliveryAudience;
    generation: number;
  }): Promise<StoredObjectDeliveryCapability>;
}

/**
 * The delivery capability, absent. Minting one signs a URL against a policy
 * this process composes no signer for, so the operation refuses by name
 * rather than answering a link nothing honours.
 */
export class UnavailableStoredObjectDeliveryService extends StoredObjectDelivery {
  static create(): UnavailableStoredObjectDeliveryService {
    return new UnavailableStoredObjectDeliveryService();
  }

  private constructor() {
    super();
  }

  async mint(): Promise<StoredObjectDeliveryCapability> {
    throw new StoredObjectCapabilityUnavailableError("Stored-object delivery");
  }
}

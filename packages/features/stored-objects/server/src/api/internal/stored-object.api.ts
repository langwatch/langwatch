import type {
  StoredObjectsAvailabilityInput,
  StoredObjectsDeliveryInput,
  StoredObjectsMetadataInput,
  StoredObjectsService,
} from "@langwatch/stored-objects-contract";

/** Deliberately small dashboard/tRPC compatibility adapter. */
export class StoredObjectsInternalApi {
  static create(service: StoredObjectsService): StoredObjectsInternalApi {
    return new StoredObjectsInternalApi(service);
  }

  private constructor(private readonly service: StoredObjectsService) {}

  metadata(input: StoredObjectsMetadataInput) {
    return this.service.getMetadata(input);
  }

  async availability(input: StoredObjectsAvailabilityInput) {
    return { status: (await this.service.getMetadata(input)).status };
  }

  async delivery(input: StoredObjectsDeliveryInput) {
    return (await this.service.resolveDelivery(input)).capability;
  }
}

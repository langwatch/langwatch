import type { PrivateRouteVariable } from "@langwatch/clickhouse-client";

import { PrivateS3AccountsRepository } from "../private-s3-accounts.repository.ts";

/** The read of the object-storage member this repository makes. */
type PrivateAccountReads = { privateAccountVariables(): readonly PrivateRouteVariable[] };

/** The `DATAPLANE_S3__` variables the object-storage member was configured with. */
export class ObjectStoragePrivateS3AccountsRepository extends PrivateS3AccountsRepository {
  private constructor(private readonly objectStorage: PrivateAccountReads) {
    super();
  }

  static create({
    objectStorage,
  }: {
    objectStorage: PrivateAccountReads;
  }): ObjectStoragePrivateS3AccountsRepository {
    return new ObjectStoragePrivateS3AccountsRepository(objectStorage);
  }

  findAccountVariables(): readonly PrivateRouteVariable[] {
    return this.objectStorage.privateAccountVariables();
  }
}

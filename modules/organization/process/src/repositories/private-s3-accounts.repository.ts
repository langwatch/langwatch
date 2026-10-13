import type { PrivateRouteVariable } from "@langwatch/clickhouse-client";

/** The private S3 account variables this process parsed at boot, by name and label. */
export abstract class PrivateS3AccountsRepository {
  abstract findAccountVariables(): readonly PrivateRouteVariable[];
}

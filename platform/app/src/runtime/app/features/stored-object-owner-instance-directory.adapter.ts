import { StoredObjectOwnerInstanceDirectoryPort } from "@langwatch/stored-object-server";
import { getAllClickHouseInstances } from "~/server/clickhouse/clickhouseClient";

/** App-owned directory adapter for the ClickHouse instances in this process. */
export class AppStoredObjectOwnerInstanceDirectory extends StoredObjectOwnerInstanceDirectoryPort {
  static create(): AppStoredObjectOwnerInstanceDirectory {
    return new AppStoredObjectOwnerInstanceDirectory("process");
  }

  static createUnavailableForTests(): AppStoredObjectOwnerInstanceDirectory {
    return new AppStoredObjectOwnerInstanceDirectory("unavailable");
  }

  private constructor(private readonly source: "process" | "unavailable") {
    super();
  }

  async listInstances() {
    if (this.source === "unavailable") return [];
    return getAllClickHouseInstances();
  }
}

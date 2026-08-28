/** @deprecated Legacy import adapter; use clickhouseClient process composition. */
export {
  _getSharedClickHouseClient,
  shutdownClickHouseConnections as closeClickHouseClient,
} from "./clickhouseClient";

// Prints whether each datastore variable a test guard reads is set, never its value, for the
// `testDatastores` task input in nx.json: a laptop and CI point at different databases, but a
// suite whose guard variable is unset skips what a suite with it set exercises.

import { pathToFileURL } from "node:url";

export const TEST_DATASTORES = [
  "LANGWATCH_TEST_DATABASE_URL",
  "LANGWATCH_TEST_REDIS_URL",
  "LANGWATCH_TEST_CLICKHOUSE_URL",
  "DATABASE_URL",
  "REDIS_URL",
  "REDIS_CLUSTER_ENDPOINTS",
  "CLICKHOUSE_URL",
  "CLICKHOUSE_CLUSTER",
  "CI_REDIS_URL",
  "CI_CLICKHOUSE_URL",
  "TEST_CLICKHOUSE_URL",
];

export const describeDatastores = (vars) =>
  TEST_DATASTORES.map((name) => `${name} ${vars[name] ? "set" : "unset"}`).join(", ");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(describeDatastores(process.env));

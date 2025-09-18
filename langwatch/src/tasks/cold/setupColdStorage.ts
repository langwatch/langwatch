import { type Client as ElasticClient } from "@elastic/elasticsearch";
import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import { TRACE_COLD_INDEX, esClient } from "../../server/elasticsearch";
import { traceMapping } from "../../../elastic/schema";
import { env } from "../../env.mjs";

const detectClusterType = async (client: ElasticClient) => {
  try {
    const info = await client.info();
    const version = info.version;

    if (env.IS_OPENSEARCH) {
      console.log(`🔍 Detected OpenSearch cluster version: ${version.number}`);
      return "opensearch";
    } else {
      console.log(`🔍 Detected Elasticsearch cluster version: ${version.number}`);
      return "elasticsearch";
    }
  } catch (error) {
    console.error("Failed to detect cluster type:", error);
    throw error;
  }
};

const checkColdStorageNodes = async (client: ElasticClient) => {
  console.log("Checking for cold storage nodes...");

  try {
    const nodes = await client.cat.nodes({
      format: "json",
      h: "name,node.role,node.attr.data",
    });

    const coldNodes = (nodes as any[]).filter((node) =>
      node["node.attr.data"] === "cold" ||
      node["node.role"]?.includes("c") // 'c' = cold role in ES
    );

    if (coldNodes.length > 0) {
      console.log(`✅ Found ${coldNodes.length} cold storage node(s):`);
      coldNodes.forEach((node) => {
        console.log(`  - ${node.name} (role: ${node["node.role"]}, data: ${node["node.attr.data"]})`);
      });
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.warn("Could not check for cold storage nodes:", error);
    return false;
  }
};

const createColdStorageIndex = async (client: ElasticClient, clusterType: string) => {
  console.log("Creating cold storage index...");

  const indexExists = await client.indices.exists({
    index: TRACE_COLD_INDEX.base,
  });

  if (!indexExists) {
    const settings: any = {
      number_of_shards: 4,
      number_of_replicas: 0,
      // Optimize for cold storage - less frequent updates, more compression
      "index.codec": "best_compression",
      "index.refresh_interval": "30s",
    };

    // Different allocation strategies for ES vs OpenSearch
    if (clusterType === "elasticsearch") {
      // Elasticsearch: Use data tier preference
      settings["index.routing.allocation.include._tier_preference"] = "data_cold";
      console.log("🧊 Configuring for Elasticsearch cold tier");
    } else {
      // OpenSearch: Use node attribute filtering
      settings["index.routing.allocation.require.data"] = "cold";
      console.log("🧊 Configuring for OpenSearch cold nodes");
    }

    await client.indices.create({
      index: TRACE_COLD_INDEX.base,
      settings: settings,
      mappings: { properties: traceMapping as Record<string, MappingProperty> },
    });
    console.log(`✅ Created cold storage index: ${TRACE_COLD_INDEX.base}`);
  } else {
    console.log(`⚠️  Cold storage index ${TRACE_COLD_INDEX.base} already exists`);
  }

  // Update mapping in case there are changes
  await client.indices.putMapping({
    index: TRACE_COLD_INDEX.base,
    properties: traceMapping as Record<string, MappingProperty>,
  });

  // Set up alias
  await client.indices.putAlias({
    index: TRACE_COLD_INDEX.base,
    name: TRACE_COLD_INDEX.alias,
  });
  console.log(`✅ Set up cold storage alias: ${TRACE_COLD_INDEX.alias}`);
};

export const setupColdStorage = async (organizationId?: string) => {
  console.log("🚀 Setting up cold storage...");

  const client = await esClient(organizationId ? { organizationId } : undefined);

  try {
    // 1. Detect cluster type
    const clusterType = await detectClusterType(client);

    // 2. Check for cold storage nodes - FAIL if not available
    const hasColdNodes = await checkColdStorageNodes(client);

    if (!hasColdNodes) {
      throw new Error("❌ Cold storage nodes not found! Cannot create cold storage without dedicated cold nodes.");
    }

    // 3. Create cold storage index
    await createColdStorageIndex(client, clusterType);

    console.log("✅ Cold storage setup completed successfully!");
    console.log("");
    console.log("📋 Summary:");
    console.log(`  - Cluster type: ${clusterType}`);
    console.log(`  - Cold nodes available: Yes`);
    console.log(`  - Cold storage index: ${TRACE_COLD_INDEX.base}`);
    console.log(`  - Cold storage alias: ${TRACE_COLD_INDEX.alias}`);
    console.log("");
    console.log("🔄 Use the moveTracesToColdStorage task to move old traces to cold storage.");

  } catch (error) {
    console.error("❌ Cold storage setup failed:", error);
    throw error;
  }
};

export default async function execute(organizationId?: string) {
  await setupColdStorage(organizationId);
}
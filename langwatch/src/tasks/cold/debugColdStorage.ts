import { TRACE_COLD_INDEX, esClient } from "../../server/elasticsearch";

export const debugColdStorage = async (organizationId?: string) => {
  console.log("🔍 Debugging cold storage index allocation...");

  const client = await esClient(organizationId ? { organizationId } : undefined);

  try {
    // 1. Check cluster health
    console.log("\n📊 Cluster Health:");
    const health = await client.cluster.health();
    console.log(`  - Status: ${health.status}`);
    console.log(`  - Active shards: ${health.active_shards}`);
    console.log(`  - Unassigned shards: ${health.unassigned_shards}`);

    // 2. Check index health specifically
    console.log(`\n🔍 Index Health for ${TRACE_COLD_INDEX.base}:`);
    try {
      const indexHealth = await client.cluster.health({
        index: TRACE_COLD_INDEX.base,
      });
      console.log(`  - Status: ${indexHealth.status}`);
      console.log(`  - Active shards: ${indexHealth.active_shards}`);
      console.log(`  - Unassigned shards: ${indexHealth.unassigned_shards}`);
    } catch (error) {
      console.log(`  - Error: ${error}`);
    }

    // 3. Check shard allocation explanation
    console.log(`\n🔧 Shard Allocation Explanation:`);
    try {
      const allocation = await client.cluster.allocationExplain({
        body: {
          index: TRACE_COLD_INDEX.base,
          shard: 0,
          primary: true,
        },
      });
      console.log("  - Allocation decisions:");
      console.log(JSON.stringify(allocation, null, 2));
    } catch (error) {
      console.log(`  - Error getting allocation explanation: ${error}`);
    }

    // 4. List all nodes with their attributes
    console.log(`\n🖥️  Node Information:`);
    const nodes = await client.cat.nodes({
      format: "json",
      h: "name,node.role,node.attr.data,disk.used_percent,heap.percent",
    });
    console.log("  - Available nodes:");
    (nodes as any[]).forEach((node) => {
      console.log(`    * ${node.name}:`);
      console.log(`      - Role: ${node["node.role"]}`);
      console.log(`      - Data attr: ${node["node.attr.data"] || "none"}`);
      console.log(`      - Disk used: ${node["disk.used_percent"] || "unknown"}%`);
      console.log(`      - Heap used: ${node["heap.percent"] || "unknown"}%`);
    });

    // 5. Check index settings
    console.log(`\n⚙️  Index Settings for ${TRACE_COLD_INDEX.base}:`);
    try {
      const settings = await client.indices.getSettings({
        index: TRACE_COLD_INDEX.base,
      });
      console.log("  - Current settings:");
      console.log(JSON.stringify(settings, null, 2));
    } catch (error) {
      console.log(`  - Error getting settings: ${error}`);
    }

    // 6. Check shards status
    console.log(`\n📋 Shard Status:`);
    try {
      const shards = await client.cat.shards({
        index: TRACE_COLD_INDEX.base,
        format: "json",
      });
      console.log("  - Shard details:");
      console.log(JSON.stringify(shards, null, 2));
    } catch (error) {
      console.log(`  - Error getting shard status: ${error}`);
    }

    // 7. Suggest fixes
    console.log(`\n💡 Potential Solutions:`);
    console.log(`  1. Check if cold nodes have enough disk space`);
    console.log(`  2. Verify cold nodes are properly configured with data tier`);
    console.log(`  3. Try relaxing allocation requirements temporarily`);
    console.log(`  4. Check cluster routing allocation settings`);

  } catch (error) {
    console.error("❌ Debug failed:", error);
    throw error;
  }
};

export default async function execute(organizationId?: string) {
  await debugColdStorage(organizationId);
}

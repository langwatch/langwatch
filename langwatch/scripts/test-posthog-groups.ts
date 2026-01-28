/**
 * Quick script to verify PostHog group registration and feature flag checks.
 *
 * Usage: tsx scripts/test-posthog-groups.ts
 */
import { PostHog } from "posthog-node";

const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST;

if (!POSTHOG_KEY) {
  console.error("POSTHOG_KEY not set. Export it or run with: POSTHOG_KEY=... tsx scripts/test-posthog-groups.ts");
  process.exit(1);
}

const posthog = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });

async function main() {
  const testProjectId = "test-project-" + Date.now();
  const testUserId = "test-user-script";

  // 1. Register a group
  console.log(`\n1. Registering group: project/${testProjectId}`);
  posthog.groupIdentify({
    groupType: "project",
    groupKey: testProjectId,
    properties: { name: "Test Project", source: "test-script" },
  });
  console.log("   -> groupIdentify called (async, will flush below)");

  // 2. Check a feature flag with the group
  console.log(`\n2. Checking flag "ui-simulations-scenarios" for user=${testUserId}, project=${testProjectId}`);
  const result = await posthog.isFeatureEnabled(
    "ui-simulations-scenarios",
    testUserId,
    {
      groups: { project: testProjectId },
      disableGeoip: true,
    },
  );
  console.log(`   -> isFeatureEnabled result: ${result}`);

  // 3. Flush and shutdown
  console.log("\n3. Flushing events to PostHog...");
  await posthog.shutdown();
  console.log("   -> Done. Check PostHog dashboard for the group and flag evaluation.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

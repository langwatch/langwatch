/**
 * Verify PostHog group registration and feature flag checks.
 *
 * Usage:
 *   cd langwatch && source .env && npx tsx scripts/test-posthog-groups.ts
 */
import { PostHog } from "posthog-node";

const POSTHOG_KEY = process.env.POSTHOG_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST;

if (!POSTHOG_KEY) {
  console.error(
    "POSTHOG_KEY not set.\n" +
      "Run: cd langwatch && source .env && npx tsx scripts/test-posthog-groups.ts",
  );
  process.exit(1);
}

console.log(`PostHog key: ${POSTHOG_KEY.slice(0, 10)}...`);
console.log(`PostHog host: ${POSTHOG_HOST ?? "(default: https://us.i.posthog.com)"}`);

const posthog = new PostHog(POSTHOG_KEY, {
  host: POSTHOG_HOST,
  flushAt: 1, // flush after every event for testing
  flushInterval: 0, // flush immediately
});

async function main() {
  const testProjectId = "test-project-verify";
  const testOrgId = "test-org-verify";
  const testUserId = "test-user-verify";

  // 1. Register user group
  console.log(`\n--- Step 1: Register user group ---`);
  console.log(`  groupType: "user", groupKey: "${testUserId}"`);
  posthog.groupIdentify({
    groupType: "user",
    groupKey: testUserId,
    properties: { name: "Test User (verification)", source: "test-script" },
  });

  // 2. Register project group
  console.log(`\n--- Step 2: Register project group ---`);
  console.log(`  groupType: "project", groupKey: "${testProjectId}"`);
  posthog.groupIdentify({
    groupType: "project",
    groupKey: testProjectId,
    properties: { name: "Test Project (verification)", source: "test-script" },
  });

  // 3. Register organization group
  console.log(`\n--- Step 3: Register organization group ---`);
  console.log(`  groupType: "organization", groupKey: "${testOrgId}"`);
  posthog.groupIdentify({
    groupType: "organization",
    groupKey: testOrgId,
    properties: {
      name: "Test Organization (verification)",
      source: "test-script",
    },
  });

  // 4. Flush group identify events
  console.log(`\n--- Step 4: Flushing group events ---`);
  await posthog.flush();
  console.log(`  Flushed.`);

  // 5. Check feature flag without groups (distinctId only)
  console.log(`\n--- Step 5: Check flag (distinctId only, no groups) ---`);
  const distinctIdResult = await posthog.isFeatureEnabled(
    "release_ui_simulations_menu_enabled",
    testUserId,
    { disableGeoip: true },
  );
  console.log(`  release_ui_simulations_menu_enabled = ${distinctIdResult}`);

  // 6. Check feature flag with user group only
  console.log(`\n--- Step 6: Check flag (with user group only) ---`);
  const userGroupResult = await posthog.isFeatureEnabled(
    "release_ui_simulations_menu_enabled",
    testUserId,
    {
      disableGeoip: true,
      groups: { user: testUserId },
    },
  );
  console.log(`  release_ui_simulations_menu_enabled (user=${testUserId}) = ${userGroupResult}`);

  // 7. Check feature flag with project group
  console.log(`\n--- Step 7: Check flag (with user + project groups) ---`);
  const projectResult = await posthog.isFeatureEnabled(
    "release_ui_simulations_menu_enabled",
    testUserId,
    {
      disableGeoip: true,
      groups: { user: testUserId, project: testProjectId },
    },
  );
  console.log(`  release_ui_simulations_menu_enabled (user=${testUserId}, project=${testProjectId}) = ${projectResult}`);

  // 8. Check feature flag with org only (no project)
  console.log(`\n--- Step 8: Check flag (with user + org groups) ---`);
  const orgResult = await posthog.isFeatureEnabled(
    "release_ui_simulations_menu_enabled",
    testUserId,
    {
      disableGeoip: true,
      groups: { user: testUserId, organization: testOrgId },
    },
  );
  console.log(`  release_ui_simulations_menu_enabled (user=${testUserId}, org=${testOrgId}) = ${orgResult}`);

  // 9. Check feature flag with all groups (user + project + org)
  console.log(`\n--- Step 9: Check flag (with all groups: user + project + org) ---`);
  const fullResult = await posthog.isFeatureEnabled(
    "release_ui_simulations_menu_enabled",
    testUserId,
    {
      disableGeoip: true,
      groups: { user: testUserId, project: testProjectId, organization: testOrgId },
    },
  );
  console.log(`  release_ui_simulations_menu_enabled (user=${testUserId}, project=${testProjectId}, org=${testOrgId}) = ${fullResult}`);

  // 10. Shutdown
  console.log(`\n--- Step 10: Shutdown ---`);
  await posthog.shutdown();

  console.log(`\nDone. Check PostHog dashboard:`);
  console.log(`  - Groups > user > "${testUserId}"`);
  console.log(`  - Groups > project > "${testProjectId}"`);
  console.log(`  - Groups > organization > "${testOrgId}"`);
  console.log(`  - Feature Flags > release_ui_simulations_menu_enabled`);

  if (distinctIdResult === undefined && projectResult === undefined) {
    console.log(
      `\nNote: All flags returned undefined. The flag "release_ui_simulations_menu_enabled"` +
        ` may not exist in PostHog yet. Create it in the dashboard first.`,
    );
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

import { requireDeploymentMode } from "../deployment-mode.ts";
import { closeDb } from "../front-door/db";
import { expect, test } from "../test.ts";
import {
  givenAMemberJoinedByInvitation,
  givenAnAdministratorOfAFreeOrganization,
  thenIAmOnTheCheckoutPage,
  thenTheOrganizationIsOnGrowth,
  whenIOpenTheSubscriptionPageOnTheFreePlan,
  whenIPayOnTheCheckoutPage,
  whenIPressUpgradeToGrowth,
} from "./steps.ts";

/**
 * Feature: Upgrading a Free organization to Growth on LangWatch Cloud
 * (specs/e2e/cloud-upgrade-journeys.feature). The stack runs saas with paymentsim as Stripe.
 */
test.describe("Cloud upgrade journeys @saas", () => {
  test.beforeEach(() => {
    requireDeploymentMode({ mode: "saas" });
  });

  test.afterAll(async () => {
    await closeDb();
  });

  /** @scenario "A Free organization with one member upgrades to Growth" */
  test("a Free organization with one member upgrades to Growth", async ({ page, request }) => {
    await givenAnAdministratorOfAFreeOrganization({ page, request });

    await whenIOpenTheSubscriptionPageOnTheFreePlan({ page });
    await whenIPressUpgradeToGrowth({ page });
    await thenIAmOnTheCheckoutPage({ page });

    await whenIPayOnTheCheckoutPage({ page });
    await thenTheOrganizationIsOnGrowth({ page });
  });

  /** @scenario "Upgrade now on the plans page reaches the checkout" */
  test("Upgrade now on the plans page reaches the checkout", async ({ page, request }) => {
    await givenAnAdministratorOfAFreeOrganization({ page, request });

    await page.goto("/settings/plans");
    const growth = page.getByTestId("plan-column-growth");
    await expect(growth).toBeVisible({ timeout: 30000 });
    await growth.getByRole("link", { name: "Upgrade now" }).click();

    await thenIAmOnTheCheckoutPage({ page });
  });

  /** @scenario "A Member who is not an administrator starts the checkout" */
  test("a Member who is not an administrator starts the checkout", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    const org = await givenAnAdministratorOfAFreeOrganization({ page, request });
    const { member, context } = await givenAMemberJoinedByInvitation({
      admin: page,
      browser,
      baseURL,
      org,
    });
    try {
      await whenIOpenTheSubscriptionPageOnTheFreePlan({ page: member });
      await whenIPressUpgradeToGrowth({ page: member });
      await thenIAmOnTheCheckoutPage({ page: member });
    } finally {
      await context.close();
    }
  });
});

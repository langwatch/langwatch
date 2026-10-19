/**
 * Personal column entries (usage, traces, sessions, library). PersonalSidebarLinks
 * only; column came from DashboardLayout (deleted). Personal project from host.
 * Spec: modules/navigation/specs/product-sidebars.feature
 */

import {
  type PersonalWorkspaceFeatures,
  usePersonalWorkspace,
} from "../../behavior/use-personal-workspace.ts";
import { isOnlineEvaluationsActivePath } from "../../model/navigation-active-state.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import {
  personalConfigureNavItem,
  personalLibraryNavItems,
  personalPullRequestsNavItem,
  personalSessionsNavItem,
  personalTracesNavItem,
  personalUsageNavItem,
} from "../../model/personal-nav-items.ts";
import { isPathUnder } from "../../model/products.ts";
import { SideMenuLink } from "../blocks/side-menu-link.tsx";

export const PersonalSidebarLinks = function PersonalSidebarLinks({
  showExpanded,
}: {
  showExpanded: boolean;
}) {
  const host = useNavigationHost();
  const pathname = host.pathname();
  const { personalProjectSlug, features } = usePersonalWorkspace();
  const tracesHref = personalProjectSlug
    ? personalTracesNavItem.hrefFor(personalProjectSlug)
    : null;

  return (
    <>
      <SideMenuLink
        icon={personalUsageNavItem.icon}
        label={personalUsageNavItem.label}
        href={personalUsageNavItem.href}
        isActive={pathname === personalUsageNavItem.href}
        showLabel={showExpanded}
      />
      {tracesHref && (
        <SideMenuLink
          icon={personalTracesNavItem.icon}
          label={personalTracesNavItem.label}
          href={tracesHref}
          isActive={pathname.includes("/traces")}
          showLabel={showExpanded}
        />
      )}
      <SideMenuLink
        icon={personalSessionsNavItem.icon}
        label={personalSessionsNavItem.label}
        href={personalSessionsNavItem.href}
        isActive={isPathUnder({ pathname, base: personalSessionsNavItem.href })}
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={personalPullRequestsNavItem.icon}
        label={personalPullRequestsNavItem.label}
        href={personalPullRequestsNavItem.href}
        isActive={isPathUnder({ pathname, base: personalPullRequestsNavItem.href })}
        showLabel={showExpanded}
      />
      <PersonalLibraryLinks
        showExpanded={showExpanded}
        pathname={pathname}
        personalProjectSlug={personalProjectSlug}
        features={features}
      />
      <SideMenuLink
        icon={personalConfigureNavItem.icon}
        label={personalConfigureNavItem.label}
        href={personalConfigureNavItem.href}
        isActive={isPathUnder({ pathname, base: personalConfigureNavItem.href })}
        showLabel={showExpanded}
      />
    </>
  );
};

/**
 * The library entries link to the personal project's own `/[project]/<section>`
 * routes, so they highlight off the current path the way the project column
 * does for project navigation.
 */
function PersonalLibraryLinks({
  showExpanded,
  pathname,
  personalProjectSlug,
  features,
}: {
  showExpanded: boolean;
  pathname: string;
  personalProjectSlug: string | null;
  features: PersonalWorkspaceFeatures | undefined;
}) {
  if (!personalProjectSlug) return null;

  return (
    <>
      {personalLibraryNavItems
        .filter((item) => features?.[item.feature])
        .map((item) => (
          <SideMenuLink
            key={item.feature}
            icon={item.icon}
            label={item.label}
            href={`/${personalProjectSlug}/${item.segment}`}
            isActive={
              item.feature === "evaluations"
                ? isOnlineEvaluationsActivePath(pathname)
                : pathname.includes(`/${item.segment}`)
            }
            showLabel={showExpanded}
          />
        ))}
    </>
  );
}

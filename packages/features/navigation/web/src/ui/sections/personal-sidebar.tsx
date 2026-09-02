/**
 * The personal column's entries: my usage, my traces, my sessions, my library.
 *
 * Moved from `platform/app/src/components/PersonalSidebar.tsx`. What travelled
 * is `PersonalSidebarLinks` — the list the product sidebar renders for the Me
 * product. The COLUMN around it belonged to `DashboardLayout`, the legacy
 * chrome this move deletes, and the shell that renders these links draws its
 * own column.
 *
 * `findPersonalProject` is gone with `platform/app/src/utils/personalProject`;
 * which project is the reader's own is a question the HOST already answers,
 * through the teams it says the reader may open, ordered with the ambient one
 * first. Asking it there rather than restating the rule here is the same
 * choice `resolveLlmOpsProjectSlug` made.
 *
 * Spec: specs/navigation/product-sidebars.feature
 */

import {
  Bot,
  ClipboardList,
  Database,
  Gauge,
  GitPullRequest,
  ListTree,
  Sliders,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { useMemo } from "react";
import { navigationApi } from "../../behavior/navigation-api";
import { isOnlineEvaluationsActivePath } from "../../model/navigation-active-state";
import { useNavigationHost } from "../../model/navigation-host";
import { isPathUnder } from "../../model/products";
import { SideMenuLink } from "../blocks/side-menu-link";
import { GovernSection } from "./govern-section";

/**
 * The advanced features a reader turned on in their personal workspace.
 *
 * Default-empty storage means an existing reader sees Traces only; the bundle
 * checkbox in `/me/configure` flips them on with one atomic write.
 */
interface PersonalWorkspaceFeatures {
  evaluations?: boolean;
  datasets?: boolean;
  annotations?: boolean;
  automations?: boolean;
}

export const PersonalSidebarLinks = function PersonalSidebarLinks({
  showExpanded,
  shouldIncludeGovernSection = true,
}: {
  showExpanded: boolean;
  shouldIncludeGovernSection?: boolean;
}) {
  const host = useNavigationHost();
  const pathname = host.pathname();
  const { personalProjectSlug, features } = usePersonalWorkspace();
  const tracesHref = personalProjectSlug ? `/${personalProjectSlug}/traces` : null;

  return (
    <>
      <SideMenuLink
        icon={Gauge}
        label="My Usage"
        href="/me"
        isActive={pathname === "/me"}
        showLabel={showExpanded}
      />
      {tracesHref && (
        <SideMenuLink
          icon={ListTree}
          label="Traces"
          href={tracesHref}
          isActive={pathname.includes("/traces")}
          showLabel={showExpanded}
        />
      )}
      <SideMenuLink
        icon={SquareTerminal}
        label="Sessions"
        href="/me/sessions"
        isActive={isPathUnder({ pathname, base: "/me/sessions" })}
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={GitPullRequest}
        label="Pull Requests"
        href="/me/pull-requests"
        isActive={isPathUnder({ pathname, base: "/me/pull-requests" })}
        showLabel={showExpanded}
      />
      <PersonalLibraryLinks
        showExpanded={showExpanded}
        pathname={pathname}
        personalProjectSlug={personalProjectSlug}
        features={features}
      />
      <SideMenuLink
        icon={Sliders}
        label="Configure"
        href="/me/configure"
        isActive={isPathUnder({ pathname, base: "/me/configure" })}
        showLabel={showExpanded}
      />
      {shouldIncludeGovernSection && <GovernSection showExpanded={showExpanded} />}
    </>
  );
};

function usePersonalWorkspace(): {
  personalProjectSlug: string | null;
  features: PersonalWorkspaceFeatures | undefined;
} {
  const host = useNavigationHost();
  const openableTeams = host.openableTeams();

  const personalProject = useMemo(
    () => openableTeams.find((team) => team.isPersonal)?.projects[0] ?? null,
    [openableTeams],
  );

  const personalProjectId = personalProject?.id ?? null;
  const featuresQuery = navigationApi.personalWorkspaceFeatures.get.useQuery(
    { projectId: personalProjectId ?? "" },
    { enabled: !!personalProjectId, refetchOnWindowFocus: false },
  );

  return {
    personalProjectSlug: personalProject?.slug ?? null,
    features: featuresQuery.data,
  };
}

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
      {features?.evaluations && (
        <SideMenuLink
          icon={ClipboardList}
          label="Online Evals"
          href={`/${personalProjectSlug}/online-evaluations`}
          isActive={isOnlineEvaluationsActivePath(pathname)}
          showLabel={showExpanded}
        />
      )}
      {features?.datasets && (
        <SideMenuLink
          icon={Database}
          label="Datasets"
          href={`/${personalProjectSlug}/datasets`}
          isActive={pathname.includes("/datasets")}
          showLabel={showExpanded}
        />
      )}
      {features?.annotations && (
        <SideMenuLink
          icon={Sparkles}
          label="Annotations"
          href={`/${personalProjectSlug}/annotations`}
          isActive={pathname.includes("/annotations")}
          showLabel={showExpanded}
        />
      )}
      {features?.automations && (
        <SideMenuLink
          icon={Bot}
          label="Automations"
          href={`/${personalProjectSlug}/automations`}
          isActive={pathname.includes("/automations")}
          showLabel={showExpanded}
        />
      )}
    </>
  );
}

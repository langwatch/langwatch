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
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { findPersonalProject } from "~/utils/personalProject";
import { isOnlineEvaluationsActivePath } from "./sidebar/navigationActiveState";
import { SideMenuLink } from "./sidebar/SideMenuLink";

/**
 * The personal navigation links, rendered by the Me sidebar. The Govern
 * group is gone because the product switcher replaces it.
 *
 * Spec: specs/navigation/product-sidebars.feature
 */
export const PersonalSidebarLinks = function PersonalSidebarLinks({
  showExpanded,
}: {
  showExpanded: boolean;
}) {
  const router = useRouter();
  const { personalProjectSlug, features } = usePersonalWorkspace();
  const tracesHref = personalProjectSlug
    ? `/${personalProjectSlug}/traces`
    : null;

  return (
    <>
      <SideMenuLink
        icon={Gauge}
        label="My Usage"
        href="/me"
        isActive={router.pathname === "/me"}
        showLabel={showExpanded}
      />
      {tracesHref && (
        <SideMenuLink
          icon={ListTree}
          label="Traces"
          href={tracesHref}
          isActive={router.pathname.includes("/traces")}
          showLabel={showExpanded}
        />
      )}
      <SideMenuLink
        icon={SquareTerminal}
        label="Sessions"
        href="/me/sessions"
        isActive={router.pathname.startsWith("/me/sessions")}
        showLabel={showExpanded}
      />
      <SideMenuLink
        icon={GitPullRequest}
        label="Pull Requests"
        href="/me/pull-requests"
        isActive={router.pathname.startsWith("/me/pull-requests")}
        showLabel={showExpanded}
      />
      <PersonalLibraryLinks
        showExpanded={showExpanded}
        pathname={router.pathname}
        personalProjectSlug={personalProjectSlug}
        features={features}
      />
      <SideMenuLink
        icon={Sliders}
        label="Configure"
        href="/me/configure"
        isActive={router.pathname.startsWith("/me/configure")}
        showLabel={showExpanded}
      />
    </>
  );
};

/**
 * Personal-workspace advanced features unlock the library nav entries
 * (datasets, evaluations, annotations, automations). Default-empty storage
 * means existing users see Traces only; the bundle checkbox in
 * /me/configure flips them on with one atomic write and an audit entry.
 */
interface PersonalWorkspaceFeatures {
  evaluations?: boolean;
  datasets?: boolean;
  annotations?: boolean;
  automations?: boolean;
}

function usePersonalWorkspace(): {
  personalProjectSlug: string | null;
  features: PersonalWorkspaceFeatures | undefined;
} {
  const session = useRequiredSession();
  const { organizations } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const personalProject = useMemo(
    () =>
      findPersonalProject({
        organizations,
        userId: session.data?.user?.id,
      }),
    [organizations, session.data?.user?.id],
  );
  const personalProjectId = personalProject?.id ?? null;
  const featuresQuery = api.personalWorkspaceFeatures.get.useQuery(
    { projectId: personalProjectId ?? "" },
    { enabled: !!personalProjectId, refetchOnWindowFocus: false },
  );

  return {
    personalProjectSlug: personalProject?.slug ?? null,
    features: featuresQuery.data,
  };
}

/**
 * The library entries link to the personal project's own
 * `/[project]/<section>` routes, so they highlight off the current path
 * the same way MainMenu does for project nav.
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

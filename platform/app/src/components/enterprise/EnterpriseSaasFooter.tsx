import { SaasBrowserService } from "@langwatch/enterprise-saas-contract";
import {
  ExtraFooterComponents,
  SaasBrowserAnalytics,
} from "@langwatch/enterprise-saas-web";
import posthog from "posthog-js";
import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import Script from "~/utils/compat/next-script";
import { useCrispBubblePolicy } from "~/utils/crispBubblePolicy";

class AppSaasBrowserService extends SaasBrowserService {
  private constructor(private readonly mutateLastLogin: () => void) {
    super();
  }

  static create(mutateLastLogin: () => void): AppSaasBrowserService {
    return new AppSaasBrowserService(mutateLastLogin);
  }

  updateLastLogin(): void {
    this.mutateLastLogin();
  }
}

const configureCrispBubble = () => undefined;

export function EnterpriseSaasFooter() {
  const session = useRequiredSession({ required: false });
  const publicEnv = usePublicEnv();
  const updateLastLogin = api.user.updateLastLogin.useMutation();
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const isSaas = Boolean(publicEnv.data?.IS_SAAS);
  useCrispBubblePolicy({ enabled: isSaas });

  const runtime = useMemo(
    () => AppSaasBrowserService.create(() => updateLastLogin.mutate({})),
    [updateLastLogin.mutate],
  );
  const analytics = useMemo(
    () =>
      SaasBrowserAnalytics.create({
        identifyPostHog: (id, properties) => posthog.identify(id, properties),
      }),
    [],
  );

  return (
    <ExtraFooterComponents
      isSaas={isSaas}
      user={
        session.data?.user
          ? {
              id: session.data.user.id,
              email: session.data.user.email,
              name: session.data.user.name,
              impersonator: session.data.user.impersonator?.id ?? null,
            }
          : undefined
      }
      organization={organization}
      project={project}
      environment={import.meta.env.MODE}
      pathname={typeof window === "undefined" ? "" : window.location.pathname}
      runtime={runtime}
      analytics={analytics}
      Script={Script}
      configureCrispBubble={configureCrispBubble}
    />
  );
}

import { type FC, type PropsWithChildren, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { OtelContext } from "./OtelContext";
import type { Span } from "@opentelemetry/api";

/**
 * Lightweight context data captured once at app level.
 * Single Responsibility: Store auth/org/team/project data for span enrichment without repeated network calls.
 */
export interface OtelContextData {
  userId?: string;
  userEmail?: string;
  organizationId?: string;
  organizationName?: string;
  teamId?: string;
  teamName?: string;
  projectId?: string;
  projectSlug?: string;
  projectName?: string;
}

/**
 * Provider that captures auth and context data once at the app level.
 * This data is then available to all spans without making additional network requests.
 */
const OtelContextProvider: FC<PropsWithChildren> = ({ children }) => {
  const [currentSpan, setCurrentSpan] = useState<Span | null>(null);
  const [contextData, setContextData] = useState<OtelContextData>({});

  const session = useSession();
  const { organization, team, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  // Update context data when auth/org/team/project changes
  useEffect(() => {
    setContextData({
      userId: session.data?.user?.id ?? undefined,
      userEmail: session.data?.user?.email ?? undefined,
      organizationId: organization?.id,
      organizationName: organization?.name ?? undefined,
      teamId: team?.id,
      teamName: team?.name ?? undefined,
      projectId: project?.id,
      projectSlug: project?.slug,
      projectName: project?.name,
    });
  }, [session.data, organization, team, project]);

  return (
    <OtelContext.Provider value={{ currentSpan, setCurrentSpan, contextData }}>
      {children}
    </OtelContext.Provider>
  );
};

export default OtelContextProvider;


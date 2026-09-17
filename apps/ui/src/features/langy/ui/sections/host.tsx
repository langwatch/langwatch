/**
 * Layout host: tRPC Provider via `langyChatTransport`; one client SSE lane for project,
 * reader, grants, flags, address and feedback.
 */

import {
  langyApi,
  LangyHostProvider,
  setLangyTrpcClient,
  type LangyHostApi,
} from "@langwatch/langy-web/langy";
import { useEffect, useMemo, type ReactNode } from "react";

import { readPublicAppConfig } from "../../../../behavior/public-config";
import { isLangyDemoProject } from "../../../../behavior/langy-demo-project";
import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useUiRpc } from "../../../../behavior/ui-rpc";

function langyProject(
  project: ReturnType<LangyHostApi["project"]>,
): ReturnType<LangyHostApi["project"]> {
  if (!project) return void 0;
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    ...(project.apiKey === void 0 ? {} : { apiKey: project.apiKey }),
    ...(project.firstMessage === void 0 ? {} : { firstMessage: project.firstMessage }),
  };
}

function langyOrganization(
  organization: ReturnType<LangyHostApi["organization"]>,
): ReturnType<LangyHostApi["organization"]> {
  if (!organization) return void 0;
  return {
    id: organization.id,
    name: organization.name,
    ...(organization.slug === void 0 ? {} : { slug: organization.slug }),
  };
}

function langyTeam(team: ReturnType<LangyHostApi["team"]>): ReturnType<LangyHostApi["team"]> {
  if (!team) return void 0;
  return {
    id: team.id,
    name: team.name,
    ...(team.isPersonal === void 0 ? {} : { isPersonal: team.isPersonal }),
    ...(team.ownerUserId === void 0 ? {} : { ownerUserId: team.ownerUserId }),
    ...(team.members === void 0 ? {} : { members: team.members }),
  };
}

function langyUser(
  user: ReturnType<LangyHostApi["currentUser"]> | null,
): ReturnType<LangyHostApi["currentUser"]> {
  if (!user) return void 0;
  return { id: user.id, name: user.name, email: user.email, image: user.image };
}

export function LangyHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const actor = session.currentUser();
  const rpc = useUiRpc();

  const organizations = langyApi.organization.getAll.useQuery(
    { isDemo: false },
    { enabled: !!actor },
  );

  const placement = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find(
          (candidate: { id: string }) => candidate.id === scope.projectId,
        );
        if (found) return { organization, team, project: found };
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  /** The one config leaf a feature package may not read itself (ADR-101). */
  const demoProjectSlug = useMemo(() => {
    try {
      return readPublicAppConfig().demoProjectSlug;
    } catch {
      return void 0;
    }
  }, []);

  const reading = route.reading();
  const host = useMemo<LangyHostApi>(
    () => ({
      project: () => langyProject(placement?.project),
      organization: () => langyOrganization(placement?.organization),
      team: () => langyTeam(placement?.team),
      // The graph read doesn't carry it; Langy's gate treats unanswered as
      // "not an administrator", the safe reading.
      organizationRole: () => void 0,
      isDemoProject: () =>
        isLangyDemoProject({ projectSlug: placement?.project.slug, demoProjectSlug }),
      currentUser: () => langyUser(actor),
      hasPermission: (permission) => session.hasPermission(permission),
      featureFlag: (flag) => session.featureFlag(flag),
      isLoading: () => !!actor && organizations.isLoading,
      route: () => ({
        params: reading.params,
        query: reading.query,
        pathname: reading.pathname ?? "",
      }),
      planManagementUrl: () => "/settings/subscription",
      setQuery: (next, options) => route.setQuery({ ...reading.query, ...next }, options),
      navigate: (to, options) =>
        options?.replace ? navigation.replace(to) : navigation.navigate(to),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [
      placement,
      demoProjectSlug,
      actor,
      session,
      organizations.isLoading,
      reading,
      route,
      navigation,
      feedback,
    ],
  );

  /**
   * The by-path dispatcher, handed over as the vanilla client Langy expects:
   * `UiRpc` is the shell's one seam onto the transport for a caller
   * (`langyChatTransport`) that cannot hold a hook.
   */
  useEffect(() => {
    setLangyTrpcClient({
      query: (path: string, input?: unknown) => rpc.query(path, input),
      mutation: (path: string, input?: unknown) => rpc.mutate(path, input),
      subscription: (path: string, input: unknown, handlers: unknown) =>
        rpc.subscribe(path, input, handlers as Parameters<typeof rpc.subscribe>[2]),
    });
    return () => setLangyTrpcClient(void 0);
  }, [rpc]);

  return <LangyHostProvider value={host}>{children}</LangyHostProvider>;
}

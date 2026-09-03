/**
 * What the Langy layout is mounted inside: the tRPC Provider its hooks run
 * on, the vanilla client `langyChatTransport` drives, and the host port for
 * project, reader, grants, flags, address and feedback. One client, not two — a second would mean a second SSE lane and cookie story.
 */

import {
  langyApi,
  LangyHostProvider,
  setLangyErrorHost,
  setLangyTrpcClient,
  type LangyHostPort,
} from "@langwatch/langy-web/screens/langy-layout";
import { useEffect, useMemo, type ReactNode } from "react";
import { useLocation, useParams } from "react-router";

import { readPublicAppConfig } from "../../../../behavior/public-config";
import { isLangyDemoProject } from "../../../../behavior/langy-demo-project";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiRpc } from "../../../../behavior/ui-rpc";

export function LangyHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const actor = session.currentUser();
  const location = useLocation();
  const params = useParams();
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
  const host = useMemo<LangyHostPort>(
    () => ({
      project: () =>
        placement
          ? {
              id: placement.project.id,
              slug: placement.project.slug,
              name: placement.project.name,
              ...(placement.project.apiKey === void 0 ? {} : { apiKey: placement.project.apiKey }),
              ...(placement.project.firstMessage === void 0
                ? {}
                : { firstMessage: placement.project.firstMessage }),
            }
          : void 0,
      organization: () =>
        placement
          ? {
              id: placement.organization.id,
              name: placement.organization.name,
              ...(placement.organization.slug === void 0
                ? {}
                : { slug: placement.organization.slug }),
            }
          : void 0,
      team: () =>
        placement
          ? {
              id: placement.team.id,
              name: placement.team.name,
              ...(placement.team.isPersonal === void 0
                ? {}
                : { isPersonal: placement.team.isPersonal }),
              ...(placement.team.ownerUserId === void 0
                ? {}
                : { ownerUserId: placement.team.ownerUserId }),
              ...(placement.team.members === void 0 ? {} : { members: placement.team.members }),
            }
          : void 0,
      // The graph read doesn't carry it; Langy's gate treats unanswered as
      // "not an administrator", the safe reading.
      organizationRole: () => void 0,
      isDemoProject: () =>
        isLangyDemoProject({ projectSlug: placement?.project.slug, demoProjectSlug }),
      currentUser: () =>
        actor ? { id: actor.id, name: actor.name, email: actor.email, image: actor.image } : void 0,
      hasPermission: (permission) => session.hasPermission(permission),
      featureFlag: (flag) => session.featureFlag(flag),
      isLoading: () => !!actor && organizations.isLoading,
      route: () => ({ params, query: reading.query, pathname: location.pathname }),
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
      params,
      location.pathname,
      route,
      navigation,
      feedback,
    ],
  );

  useEffect(() => {
    setLangyErrorHost(host);
    return () => setLangyErrorHost(void 0);
  }, [host]);

  /**
   * The by-path dispatcher, handed over as the vanilla client Langy expects:
   * `UiRpcPort` is the shell's one seam onto the transport for a caller
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

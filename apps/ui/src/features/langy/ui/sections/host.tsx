/**
 * What the Langy layout is mounted inside.
 *
 * Three things go around it: the tRPC Provider the package's hooks run on, the
 * VANILLA client `langyChatTransport` drives one turn from, and the host port
 * that answers for the project, the reader, their grants, the release flags,
 * the address and the feedback.
 *
 * THE VANILLA CLIENT IS THE SAME CLIENT. `langy.onTurnStream` is bridged into a
 * `ReadableStream<UIMessageChunk>` from outside React, so it cannot use a hook,
 * and `platform/app` handed it the application's own tRPC client. Handing the
 * package a second one would mean a second SSE lane and a second cookie story,
 * so this hands it the one the shell already built — the same lane, the same
 * batching window, the same session.
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

  const reading = route.reading();
  const host = useMemo<LangyHostPort>(
    () => ({
      project: () =>
        placement
          ? {
              id: placement.project.id,
              slug: placement.project.slug,
              name: placement.project.name,
              ...(placement.project.apiKey === void 0
                ? {}
                : { apiKey: placement.project.apiKey }),
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
      /**
       * The reader's standing in the organization.
       *
       * The graph read does not carry it, and Langy's own visibility gate
       * treats an unanswered role as "not an administrator" — the safe
       * reading, since an administrator who is also a member of the team
       * passes the same gate on the membership branch.
       */
      organizationRole: () => void 0,
      currentUser: () =>
        actor ? { id: actor.id, name: actor.name, email: actor.email, image: actor.image } : void 0,
      hasPermission: (permission) => session.hasPermission(permission),
      featureFlag: (flag) => session.featureFlag(flag),
      isLoading: () => !!actor && organizations.isLoading,
      route: () => ({ params, query: reading.query, pathname: location.pathname }),
      /**
       * Where a reader lifts a plan limit.
       *
       * `IS_SAAS` is the application's own public configuration; the dock only
       * ever needs the destination it implies.
       */
      planManagementUrl: () => "/settings/subscription",
      setQuery: (next, options) => route.setQuery({ ...reading.query, ...next }, options),
      navigate: (to, options) =>
        options?.replace ? navigation.replace(to) : navigation.navigate(to),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [
      placement,
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
   * The by-path dispatcher, handed over as the vanilla client Langy expects.
   *
   * `UiRpcPort` is the shell's one seam onto the transport for a caller that
   * cannot hold a hook, and `langyChatTransport` is exactly that caller: it
   * opens `langy.onTurnStream` from inside a `ReadableStream` and mutates
   * `createConversation` / `continueConversation` from a plain async function.
   * Adapted here rather than in the package, because the shapes either side are
   * this application's and that package's respectively.
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

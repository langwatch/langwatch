/**
 * Target reference ids, resolved to what a person calls them.
 *
 * The application's `~/hooks/useTargetNameMap` went to `@langwatch/experiment-web`
 * with the experiments workbench while this family was moving; naming that
 * package from here would be a web-to-web edge onto a family whose transport
 * and host port are not this one's. The read is two queries and a Map, and both
 * queries are already in this family's procedure map, so it is stated here
 * against this family's transport instead.
 */

import { useMemo } from "react";

import type { TargetKind } from "../ui/elements/agent-testing/shared/target-mark";
import { api } from "./scenario-api";
import { useOrganizationTeamProject } from "./use-organization-team-project";

/**
 * What a target reference id stands for: the name it reads as, the kind of
 * agent behind it, and, for a connected agent, the environment and the owner
 * that tell one row of that name from another (ADR-128).
 */
export interface TargetIdentity {
  name: string;
  /** The kind of agent, or the prompt, the target runs against. */
  kind: TargetKind;
  /** The environment of a connected agent; nothing for every other target. */
  environment: string | null;
  /** The display name of the owner of a personal development agent. */
  ownerName: string | null;
}

/** The kinds an agent row can be, as the mark of a target reads them. */
const AGENT_KINDS = new Set<TargetKind>(["signature", "code", "http", "workflow", "connected"]);

/** The kind of an agent row, or `unknown` for a type the mark has no icon for. */
function agentKind(type: string): TargetKind {
  return AGENT_KINDS.has(type as TargetKind) ? (type as TargetKind) : "unknown";
}

/**
 * The agents and prompts of the project, as a Map from target reference id to
 * what a person calls that target.
 */
export function useTargetIdentityMap(): Map<string, TargetIdentity> {
  const { project } = useOrganizationTeamProject();

  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );
  const { data: prompts } = api.prompts.getAllPromptsForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  return useMemo(() => {
    const map = new Map<string, TargetIdentity>();
    for (const agent of agents ?? []) {
      map.set(agent.id, {
        name: agent.name,
        kind: agentKind(agent.type),
        environment: agent.type === "connected" ? agent.environment : null,
        ownerName: agent.owner?.name ?? null,
      });
    }
    for (const prompt of prompts ?? []) {
      // Prefer the globally-unique handle, then the plain name (always
      // present), then the id as last resort. This keeps placeholder prompts
      // (no handle yet) from collapsing to their raw cuid.
      map.set(prompt.id, {
        name: prompt.handle ?? prompt.name ?? prompt.id,
        kind: "prompt",
        environment: null,
        ownerName: null,
      });
    }
    return map;
  }, [agents, prompts]);
}

/**
 * The same lookup reduced to the display name alone, for the callers that
 * only print a name.
 */
export function useTargetNameMap(): Map<string, string> {
  const identities = useTargetIdentityMap();
  return useMemo(
    () => new Map([...identities].map(([id, identity]) => [id, identity.name] as const)),
    [identities],
  );
}

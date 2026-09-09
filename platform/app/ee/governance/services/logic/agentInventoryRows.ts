// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Agents screen's rows, folded out of the two tables that know an agent
 * exists.
 *
 * Pure, and deliberately not part of the service: the union rule and every
 * "we have not measured this" decision is a judgement call, and a judgement
 * call that needs three datastores to assert is one nobody re-reads.
 *
 * TWO ORIGINS, ONE LIST. A LangWatch-native agent registers itself from the
 * process that runs it (ADR-128, `Agent`); a provider-side agent is found by
 * asking the provider (`DiscoveredAgent`). An admin who opens this page asks
 * what runs against the organization, and that question means both. Showing
 * one origin would answer a narrower question in the wider question's words.
 *
 * WHAT IS LEFT EMPTY, AND WHY. `GovernanceAgentRow` carries spend, request
 * counts and health. Neither table measures any of the three, so all three are
 * null on every row and the page draws the dash it already draws for a sample
 * agent that has never run (`AgentFigure`). A zero is a measurement: it says
 * the agent ran and spent nothing. We have not taken that measurement, so we
 * do not get to report it.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

import type {
  AgentSource,
  GovernanceAgentRow,
} from "~/components/governance/agents/agentRows";

import { DATABRICKS_GENIE_ADAPTER_ID } from "../pullers/databricksGenie.puller";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../pullers/dataverseEnvironment";

/** One connected agent, as the organization-wide read hands it over. */
export interface RegisteredAgentRecord {
  id: string;
  name: string;
  /** ADR-128's declared stage. Null on a row the SDK never gave one. */
  environment: string | null;
  ownerUserId: string | null;
  /** When the agent registered itself. The one date that means what it says. */
  createdAt: Date;
  /** Presence, per ADR-128: the last time an instance held the socket. */
  lastSeenAt: Date | null;
}

/** One provider-side agent, as `DiscoveredAgent` stores it. */
export interface DiscoveredAgentRecord {
  id: string;
  /** The source type the pull resolved, e.g. `databricks_genie`. */
  provider: string;
  displayText: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface AgentInventory {
  rows: GovernanceAgentRow[];
  /**
   * Providers this page has no chip for, so the caller can say so out loud.
   * Empty in every case the platform can currently produce.
   */
  unknownProviders: string[];
}

/**
 * The provider a discovered row came from, as the chip the page offers.
 *
 * Closed on purpose. `AGENT_SOURCES` is the set of chips the filter bar can
 * draw, and filing a Genie space under "Custom" because no chip matched would
 * teach a reader that Custom means "registered with LangWatch" on one row and
 * "we could not tell" on the next. A provider missing from here is dropped and
 * reported rather than mislabelled, and the drop is reachable only if someone
 * teaches a third source type to list agents without giving it a chip.
 */
const SOURCE_BY_PROVIDER: Readonly<Record<string, AgentSource>> = {
  [DATABRICKS_GENIE_ADAPTER_ID]: "databricks",
  [COPILOT_STUDIO_DATAVERSE_ADAPTER_ID]: "copilot_studio",
};

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Whole minutes since `at`, floored at zero so a clock skew is not negative. */
function minutesSince({ at, now }: { at: Date; now: Date }): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / MINUTE_MS));
}

/** Whole days since `at`, floored at zero for the same reason. */
function daysSince({ at, now }: { at: Date; now: Date }): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / DAY_MS));
}

/**
 * A connected agent as a row.
 *
 * `lastSeenAt` fills "last active" and nothing else does. ADR-128 writes that
 * column while the agent's process holds the socket, which makes it the one
 * record the platform keeps of the agent doing anything; an agent that has
 * registered and never connected has none, which is exactly the sentence the
 * dash carries there (`AGENT_NEVER_RUN`).
 *
 * `createdAt` fills "registered" because that is the moment it describes.
 */
function registeredRow({
  agent,
  ownerName,
  now,
}: {
  agent: RegisteredAgentRecord;
  ownerName: string | null;
  now: Date;
}): GovernanceAgentRow {
  return {
    // Prefixed because this list has two id spaces behind it and the page uses
    // the id as a React key and as the spend ranking's key. The prefix also
    // keeps the origin readable in a test failure.
    id: `registered:${agent.id}`,
    name: agent.name,
    environment: agent.environment,
    owner: ownerName,
    // The connected agent's config declares its parameters and its SDK, never
    // a model (`connectedComponentSchema`). The platform therefore does not
    // know what this agent calls, and an empty list is how the table says so.
    models: [],
    source: "custom",
    costUsd30d: null,
    requests30d: null,
    lastActiveMinutesAgo:
      agent.lastSeenAt === null
        ? null
        : minutesSince({ at: agent.lastSeenAt, now }),
    health: null,
    registeredDaysAgo: daysSince({ at: agent.createdAt, now }),
  };
}

/**
 * A provider-side agent as a row.
 *
 * Four fields stay null that a first reading would want to fill, and each one
 * is the same mistake in a different column:
 *
 * `environment` is ADR-128's deployment stage. A Dataverse environment address
 * and a Databricks workspace host are places, not stages, so neither belongs
 * in a column a reader scans for "production".
 *
 * `lastActiveMinutesAgo` is not `lastSeenAt`. A provider lists every agent it
 * holds on every sync, so an agent that has never once been called still has a
 * fresh `lastSeenAt`. Reading it as activity would report every discovered
 * agent as busy.
 *
 * `registeredDaysAgo` is not `firstSeenAt`. That date is when WE first saw the
 * agent, which for an agent that existed for a year before the source was
 * connected is a year out. Under a column headed Registered it would read as
 * the agent's own age.
 *
 * `owner` is null because no provider field here names one, and unclaimed is
 * the honest reading: it puts the agent on the ownership card's actionable
 * line rather than crediting it to somebody.
 */
function discoveredRow({
  agent,
  source,
}: {
  agent: DiscoveredAgentRecord;
  source: AgentSource;
}): GovernanceAgentRow {
  return {
    id: `discovered:${agent.id}`,
    name: agent.displayText,
    environment: null,
    owner: null,
    // `metadata` is not read at all, deliberately. It is provider-native and
    // open-ended, and shipping it to a browser wholesale is how a field nobody
    // vetted reaches a screen. A key earns its way onto a row by having a
    // column that means it.
    models: [],
    source,
    costUsd30d: null,
    requests30d: null,
    lastActiveMinutesAgo: null,
    health: null,
    registeredDaysAgo: null,
  };
}

/**
 * Both origins as one list, registered agents first, and NOTHING matched
 * between them.
 *
 * An agent registered from code and an agent a provider named become two rows
 * even when they carry the same name, and that is the decision this function
 * exists to hold. The only signal the two tables share is the name: a
 * connected agent's `identityKey` is built from the project, the name, the
 * environment and the registering credential's scope
 * (`connected-agents/identity.ts`), and none of that has a counterpart in a
 * provider's own agent id. So a merge here would rest on a string match with
 * no corroborating evidence at all.
 *
 * The two ways of being wrong are not worth the same. A duplicate row is
 * visible: a reader sees two similar names, works out the fleet is
 * over-counted, and can go and check. A wrong merge is invisible: an agent
 * that exists at a provider is absent from the one page whose job is to say
 * what exists, and no reader can detect an absence. On an inventory,
 * over-counting is a nuisance and under-counting is a lie.
 *
 * The People screen keeps two providers naming the same address as two rows
 * for the same reason (`governancePeopleScreen.service.ts`). Deciding that two
 * records are one thing is a matching engine's job, with evidence behind it,
 * and there is no such engine for agents.
 *
 * Registered first only so the order is stable. The page sorts on top of this.
 */
export function buildAgentInventory({
  registered,
  discovered,
  memberNames,
  now,
}: {
  registered: readonly RegisteredAgentRecord[];
  discovered: readonly DiscoveredAgentRecord[];
  memberNames: readonly { userId: string; name: string }[];
  now: Date;
}): AgentInventory {
  const nameByUser = new Map(memberNames.map((m) => [m.userId, m.name]));

  const registeredRows = registered.map((agent) =>
    registeredRow({
      agent,
      ownerName:
        agent.ownerUserId === null
          ? null
          : (nameByUser.get(agent.ownerUserId) ?? null),
      now,
    }),
  );

  const unknownProviders = new Set<string>();
  const discoveredRows = discovered.flatMap((agent) => {
    const source = SOURCE_BY_PROVIDER[agent.provider];
    if (source === undefined) {
      unknownProviders.add(agent.provider);
      return [];
    }
    return [discoveredRow({ agent, source })];
  });

  return {
    rows: [...registeredRows, ...discoveredRows],
    unknownProviders: [...unknownProviders],
  };
}

import { CardGrid } from "@langwatch/design-system/card";
import { Drawer } from "@langwatch/design-system/drawer";
import { FilterChips } from "@langwatch/design-system/filter-chips";
import {
  CustomIcon,
  IconGlyph,
  LLMIcon,
  MoreVerticalIcon,
  OpenTelemetryIcon,
} from "@langwatch/design-system/icons";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListPage, type ListPageState } from "@langwatch/design-system/list-page";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Badge, Button } from "@langwatch/design-system/primitives";
import { ProductScope } from "@langwatch/design-system/product-scope";
import { ResourceTile } from "@langwatch/design-system/resource-tile";
import { SummaryList, SummaryListItem } from "@langwatch/design-system/summary-list";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { useRef, useState, type ReactNode } from "react";

export type AgentKind = "prompt" | "http" | "connected";

/** One agent of the catalogue. Integer ids and fixed dates keep the example deterministic. */
export interface Agent {
  id: number;
  name: string;
  description: string;
  kind: AgentKind;
  updated: string;
  /** Where the agent runs, in the label the detail drawer uses for it. */
  runsOn: { label: string; value: string };
  scenarios: number;
}

/** What the reader asked for. Your application opens its own editor, chooser or history. */
export type AgentRequest =
  | { kind: "create" }
  | { kind: "edit"; agent: Agent }
  | { kind: "history"; agent: Agent };

type KindFilter = "all" | AgentKind;

/**
 * Only the stories use this: it opens the example already in one of its states.
 * Leave it out in your application.
 */
export interface ResourceCatalogueStart {
  view?: "ready" | "loading" | "failed";
  query?: string;
  kind?: KindFilter;
  /** Opens the detail drawer for this agent id. */
  openId?: number;
}

const DOCS = "https://docs.langwatch.ai/agents/overview";

const KINDS: Record<AgentKind, { label: string; icon: ReactNode }> = {
  prompt: { label: "Prompt", icon: <IconGlyph icon={<LLMIcon />} size="24px" /> },
  http: { label: "HTTP", icon: <IconGlyph icon={<CustomIcon />} size="24px" /> },
  connected: {
    label: "Connected",
    icon: <IconGlyph icon={<OpenTelemetryIcon />} monochrome size="24px" />,
  },
};

export const SEED_AGENTS: Agent[] = [
  {
    id: 1,
    name: "Support HTTP agent",
    description: "Posts each scenario message to the support backend and returns its reply.",
    kind: "http",
    updated: "10 Oct 2026",
    runsOn: { label: "Endpoint", value: "POST https://support.example.com/api/chat" },
    scenarios: 6,
  },
  {
    id: 2,
    name: "Refund policy prompt",
    description: "Answers refund questions from the policy and hands off to a person when unsure.",
    kind: "prompt",
    updated: "9 Oct 2026",
    runsOn: { label: "Model", value: "openai/gpt-5-mini" },
    scenarios: 4,
  },
  {
    id: 3,
    name: "Delivery status lookup",
    description: "Looks up an order's carrier and delivery estimate.",
    kind: "http",
    updated: "8 Oct 2026",
    runsOn: { label: "Endpoint", value: "GET https://support.example.com/api/delivery" },
    scenarios: 2,
  },
  {
    id: 4,
    name: "Escalation summary writer",
    description: "Summarises a long conversation for the person taking it over.",
    kind: "prompt",
    updated: "5 Oct 2026",
    runsOn: { label: "Model", value: "anthropic/claude-sonnet-5-5" },
    scenarios: 3,
  },
  {
    id: 5,
    name: "Support assistant (production)",
    description: "The live assistant, connected through its OpenTelemetry traces.",
    kind: "connected",
    updated: "11 Oct 2026",
    runsOn: { label: "Source", value: "OpenTelemetry traces" },
    scenarios: 0,
  },
  {
    id: 6,
    name: "Billing questions",
    description: "Explains invoices and plan changes in plain words.",
    kind: "prompt",
    updated: "2 Oct 2026",
    runsOn: { label: "Model", value: "openai/gpt-5-mini" },
    scenarios: 1,
  },
];

/** Only the LongNames story uses this: a first agent whose name and text overrun its tile. */
export const LONG_NAME_AGENTS: Agent[] = [
  {
    id: 1,
    name: "Production customer support assistant for the escalation workflow, rotated every quarter",
    description:
      "Posts each message of a customer-facing escalation scenario to the support backend, waits for the reply, and returns it together with the headers the evaluation needs to score the answer.",
    kind: "http",
    updated: "10 Oct 2026",
    runsOn: { label: "Endpoint", value: "POST https://support.example.com/api/chat" },
    scenarios: 6,
  },
  ...SEED_AGENTS.slice(1),
];

/** The default for `onRequest`: says what your application would open. */
function announce(request: AgentRequest) {
  if (request.kind === "create") {
    toaster.create({
      type: "info",
      title: "New agent",
      description: "Your application opens its agent type chooser here.",
    });
    return;
  }
  toaster.create({
    type: "info",
    title:
      request.kind === "edit" ? `Edit ${request.agent.name}` : `History of ${request.agent.name}`,
    description:
      request.kind === "edit"
        ? "Your application opens the editor for this agent here."
        : "Your application opens this agent's saved versions here.",
  });
}

function agentPrompt({ name }: { name: string }): string {
  return `Create a LangWatch HTTP agent called "${name}" that posts each scenario message to our support endpoint and returns the reply.`;
}

function matches({ agent, query }: { agent: Agent; query: string }): boolean {
  const wanted = query.trim().toLowerCase();
  return (
    wanted === "" ||
    agent.name.toLowerCase().includes(wanted) ||
    agent.description.toLowerCase().includes(wanted)
  );
}

function listStateOf({
  view,
  total,
  shown,
}: {
  view: "ready" | "loading" | "failed";
  total: number;
  shown: number;
}): ListPageState {
  if (view === "loading") return "loading";
  if (view === "failed") return "error";
  if (total === 0) return "empty";
  return shown === 0 ? "no-results" : "ready";
}

function describeNoResults({ query, kind }: { query: string; kind: KindFilter }): string {
  const typed = query.trim();
  if (kind === "all") return `No agent matches "${typed}".`;
  const label = KINDS[kind].label;
  return typed === "" ? `You have no ${label} agents.` : `No ${label} agent matches "${typed}".`;
}

/**
 * The Agents page as a catalogue of tiles, with a read-only detail drawer. The application owns
 * the agents and what `onRequest` opens; this owns the shapes, the filters and the focus.
 */
export function ResourceCatalogue({
  agents = SEED_AGENTS,
  onRequest = announce,
  start = {},
}: {
  agents?: Agent[];
  onRequest?: (request: AgentRequest) => void;
  start?: ResourceCatalogueStart;
}) {
  const [view, setView] = useState(start.view ?? "ready");
  const [query, setQuery] = useState(start.query ?? "");
  const [kind, setKind] = useState<KindFilter>(start.kind ?? "all");
  const [openId, setOpenId] = useState(start.openId);
  const [drawerOpen, setDrawerOpen] = useState(start.openId !== undefined);
  const openers = useRef(new Map<number, HTMLButtonElement>());

  const searched = agents.filter((agent) => matches({ agent, query }));
  const visible = searched.filter((agent) => kind === "all" || agent.kind === kind);
  const countOf = (of: AgentKind) => searched.filter((agent) => agent.kind === of).length;
  const filtering = query.trim() !== "" || kind !== "all";
  const clearFilters = () => {
    setQuery("");
    setKind("all");
  };
  const detail = agents.find((agent) => agent.id === openId);

  const request = (asked: AgentRequest) => {
    setDrawerOpen(false);
    onRequest(asked);
  };

  return (
    <ProductScope product="llm-ops">
      <ListPage
        title="Agents"
        description="The agents your scenarios and evaluations run against."
        actions={
          <PageLayout.HeaderButton primary onClick={() => onRequest({ kind: "create" })}>
            New agent
          </PageLayout.HeaderButton>
        }
        state={listStateOf({ view, total: agents.length, shown: visible.length })}
        toolbar={{
          search: {
            value: query,
            onChange: setQuery,
            placeholder: "Search agents",
            ariaLabel: "Search agents",
          },
          filters: (
            <FilterChips
              groupLabel="Filter agents by type"
              countNoun={{ singular: "agent", plural: "agents" }}
              value={kind}
              onChange={(next) => setKind(asKind(next) ?? "all")}
              items={[
                { value: "all", label: "All", count: searched.length },
                { value: "prompt", label: KINDS.prompt.label, count: countOf("prompt") },
                { value: "http", label: KINDS.http.label, count: countOf("http") },
                { value: "connected", label: KINDS.connected.label, count: countOf("connected") },
              ]}
            />
          ),
          summary: `${visible.length} of ${agents.length} agents`,
          onClearFilters: filtering ? clearFilters : undefined,
        }}
        error={{
          title: "Couldn't load agents",
          description: "The agents service did not answer. Nothing was changed.",
          onRetry: () => setView("ready"),
          next: [{ kind: "docs", label: "Agent troubleshooting", href: DOCS }],
        }}
        empty={{
          title: "No agents yet",
          description:
            "An agent is what your scenarios and evaluations talk to. Add one here or let your coding agent set it up.",
          icon: <IconGlyph icon={<CustomIcon />} size="24px" />,
          next: [
            { kind: "docs", label: "Read about agents", href: DOCS },
            { kind: "agent-prompt", prompt: agentPrompt({ name: "Support HTTP agent" }) },
          ],
        }}
        noResults={{
          description: describeNoResults({ query, kind }),
          onClear: clearFilters,
          next: [
            { kind: "docs", label: "Read about agents", href: DOCS },
            {
              kind: "agent-prompt",
              prompt: agentPrompt({ name: query.trim() || "Support HTTP agent" }),
            },
          ],
        }}
      >
        <CardGrid columns={3} data-testid="agent-catalogue">
          {visible.map((agent) => (
            <ResourceTile
              key={agent.id}
              data-testid={`agent-tile-${agent.id}`}
              icon={KINDS[agent.kind].icon}
              title={agent.name}
              description={agent.description}
              meta={`Updated ${agent.updated}`}
              badges={<Badge variant="subtle">{KINDS[agent.kind].label}</Badge>}
              opener={
                <button
                  type="button"
                  aria-label={agent.name}
                  ref={(node) => {
                    if (node) openers.current.set(agent.id, node);
                    else openers.current.delete(agent.id);
                  }}
                  onClick={() => {
                    setOpenId(agent.id);
                    setDrawerOpen(true);
                  }}
                />
              }
              menu={
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <Button size="xs" variant="ghost" aria-label={`Actions for ${agent.name}`}>
                      <MoreVerticalIcon size={16} />
                    </Button>
                  </Menu.Trigger>
                  <Menu.Content>
                    <Menu.Item value="edit" onClick={() => onRequest({ kind: "edit", agent })}>
                      Edit
                    </Menu.Item>
                    <Menu.Item
                      value="history"
                      onClick={() => onRequest({ kind: "history", agent })}
                    >
                      View history
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Root>
              }
            />
          ))}
        </CardGrid>
      </ListPage>

      {detail && (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={detail.name}
          eyebrow={{ label: `${KINDS[detail.kind].label} agent` }}
          subtitle={detail.description}
          badges={<Badge variant="subtle">{KINDS[detail.kind].label}</Badge>}
          size="md"
          entityKey={String(detail.id)}
          finalFocusEl={() => openers.current.get(detail.id) ?? null}
          footer={{
            cancel: { label: "Done", onClick: () => setDrawerOpen(false) },
            utilityActions: [
              { label: "View history", onClick: () => request({ kind: "history", agent: detail }) },
            ],
            primaryAction: {
              label: "Edit agent",
              onClick: () => request({ kind: "edit", agent: detail }),
            },
          }}
        >
          <SummaryList>
            <SummaryListItem label="Type">{KINDS[detail.kind].label}</SummaryListItem>
            <SummaryListItem label={detail.runsOn.label}>
              <InlineCode>{detail.runsOn.value}</InlineCode>
            </SummaryListItem>
            <SummaryListItem label="Last updated">{detail.updated}</SummaryListItem>
            <SummaryListItem label="Used by">
              {detail.scenarios === 0
                ? "No scenarios yet"
                : `${detail.scenarios} ${detail.scenarios === 1 ? "scenario" : "scenarios"}`}
            </SummaryListItem>
          </SummaryList>
        </Drawer>
      )}

      <Toaster />
    </ProductScope>
  );
}

function asKind(value: string): AgentKind | undefined {
  return (["prompt", "http", "connected"] as const).find((known) => known === value);
}

/**
 * Green marks a rate from a stored cost rule rather than the model catalogue. The `llmModelCost`
 * drawer stays registered outside this move — a trace's unmapped-cost suggestion opens it too.
 * Contract: specs/model-providers/model-cost-scoping.feature.
 */

import { formatCurrency } from "@langwatch/design-system/format-currency";
import { ListPage } from "@langwatch/design-system/list-page";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Button, Code, NativeSelect, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Coins, MoreVertical, Plus } from "lucide-react";
import { useState } from "react";

import { modelProviderApi } from "../../behavior/model-provider-api.ts";
import { useAllModelProvidersList } from "../../behavior/use-all-model-providers-list.ts";
import { formatRate } from "../../model/cost-rate-text.ts";
import { toLLMModelCostRow } from "../../model/llm-model-cost-row.ts";
import {
  filterAndSortCosts,
  nextSort,
  providerOf,
  type ModelCostSort,
  type ModelCostSortKey,
} from "../../model/model-cost-table.ts";
import {
  MODEL_COST_MANAGE_PERMISSION,
  useModelProviderHost,
} from "../../model/model-provider-host.ts";
import { RegexHighlight } from "../elements/regex-highlight.tsx";

/** One rate as US dollars per million tokens; the exact per-token figure sits in the tooltip. */
function RateCell({ rate, isCustom }: { rate: number | undefined; isCustom: boolean }) {
  return (
    <ListTable.Cell nowrap>
      {rate !== undefined && (
        <Tooltip content={`$${formatRate(rate)} per token`}>
          <Text
            as="span"
            display="inline-block"
            whiteSpace="nowrap"
            textStyle="sm"
            fontVariantNumeric="tabular-nums"
            color={isCustom ? "green.fg" : undefined}
          >
            {formatCurrency({ amount: rate * 1_000_000, currency: "USD" })}
            <Text as="span" color="fg.muted" textStyle="xs">
              {" "}
              / 1M
            </Text>
          </Text>
        </Tooltip>
      )}
    </ListTable.Cell>
  );
}

/** The model name in code style; a link to its provider's drawer when that provider is set up. */
function ModelNameCell(props: { model: string; isCustom: boolean; modelProviderId?: string }) {
  const host = useModelProviderHost();
  const { organizationId, projectId } = host.scope();
  const code = (
    <Code truncate maxWidth="220px" color={props.isCustom ? "green.fg" : undefined}>
      {props.model}
    </Code>
  );
  if (!props.modelProviderId) return code;
  return (
    <Button
      variant="plain"
      size="xs"
      padding={0}
      height="auto"
      aria-label={`Open provider for ${props.model}`}
      onClick={(event) => {
        event.stopPropagation();
        host.openPlatformDrawer({
          drawer: "editModelProvider",
          params: {
            projectId,
            organizationId,
            providerKey: props.model.split("/")[0],
            modelProviderId: props.modelProviderId,
          },
        });
      }}
    >
      {code}
    </Button>
  );
}

/** A stored rule opens for editing; a catalogue rate opens as a new rule that overrides it. */
const editorParams = (row: { id?: string; model: string }) =>
  row.id ? { id: row.id } : { cloneModel: row.model };

function SortHeader(props: {
  label: string;
  sortKey: ModelCostSortKey;
  sort: ModelCostSort | null;
  onSort: (key: ModelCostSortKey) => void;
  minWidth?: string;
}) {
  const active = props.sort?.key === props.sortKey ? props.sort.direction : false;
  return (
    <ListTable.SortHeader
      minWidth={props.minWidth}
      sorted={active}
      onSort={() => props.onSort(props.sortKey)}
    >
      {props.label}
    </ListTable.SortHeader>
  );
}

function countLine(args: { loaded: boolean; isFiltering: boolean; shown: number; total: number }) {
  if (!args.loaded) return "What each model costs per token.";
  if (args.isFiltering) return `Showing ${args.shown} of ${args.total} models.`;
  return `What each of the ${args.total} models costs per token.`;
}

function pageState(args: { isLoading: boolean; noCosts: boolean; noMatches: boolean }) {
  if (args.isLoading) return "loading";
  if (args.noCosts) return "empty";
  if (args.noMatches) return "no-results";
  return "ready";
}

function ProviderFilters(props: {
  provider: string;
  onProvider: (value: string) => void;
  customOnly: boolean;
  onCustomOnly: (value: boolean) => void;
  providerCounts: Map<string, number>;
  total: number;
}) {
  return (
    <>
      <NativeSelect.Root width="56">
        <NativeSelect.Field
          aria-label="Filter by provider"
          value={props.provider}
          onChange={(event) => props.onProvider(event.target.value)}
        >
          <option value="">All providers ({props.total})</option>
          {[...props.providerCounts]
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([name, count]) => (
              <option key={name} value={name}>
                {name} ({count})
              </option>
            ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <Button
        size="sm"
        variant={props.customOnly ? "solid" : "outline"}
        aria-pressed={props.customOnly}
        onClick={() => props.onCustomOnly(!props.customOnly)}
      >
        Custom only
      </Button>
    </>
  );
}

const COSTS_DOCS = {
  kind: "docs",
  label: "How model costs work",
  href: "https://langwatch.ai/docs/integration/typescript/tutorials/tracking-llm-costs",
} as const;

export default function ModelCostsScreen() {
  const host = useModelProviderHost();
  const { projectId } = host.scope();
  const llmModelCosts = modelProviderApi.llmModelCost.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  const [search, setSearch] = useState("");
  const [matchModel, setMatchModel] = useState("");
  const [provider, setProvider] = useState("");
  const [customOnly, setCustomOnly] = useState(false);
  const [sort, setSort] = useState<ModelCostSort | null>(null);
  const onSort = (key: ModelCostSortKey) => setSort((current) => nextSort({ current, key }));

  const rows = (llmModelCosts.data ?? []).map(toLLMModelCostRow);
  const providerCounts = new Map<string, number>();
  for (const row of rows) {
    providerCounts.set(providerOf(row), (providerCounts.get(providerOf(row)) ?? 0) + 1);
  }
  const { providers } = useAllModelProvidersList();
  const providerRows = new Map<string, string>();
  for (const candidate of providers) {
    if (candidate.enabled && !providerRows.has(candidate.provider)) {
      providerRows.set(candidate.provider, candidate.id);
    }
  }
  const visibleRows = filterAndSortCosts({ rows, search, matchModel, provider, customOnly, sort });
  const needle = search.trim();
  const isFiltering = !!needle || !!matchModel.trim() || !!provider || customOnly;
  const noCosts = llmModelCosts.data?.length === 0;
  const noMatches = rows.length > 0 && visibleRows.length === 0;
  const clearFilters = () => {
    setSearch("");
    setMatchModel("");
    setProvider("");
    setCustomOnly(false);
  };

  const state = pageState({ isLoading: llmModelCosts.isLoading, noCosts, noMatches });
  const shared = {
    title: "Model costs",
    description: countLine({
      loaded: !!llmModelCosts.data,
      isFiltering,
      shown: visibleRows.length,
      total: rows.length,
    }),
    actions: (
      <PageLayout.HeaderButton
        primary
        data-testid="add-model-cost"
        onClick={() => host.openPlatformDrawer({ drawer: "llmModelCost" })}
        disabled={!host.hasPermission(MODEL_COST_MANAGE_PERMISSION)}
      >
        <Plus size={14} />
        Add new model
      </PageLayout.HeaderButton>
    ),
    toolbar:
      rows.length > 0
        ? {
            search: {
              value: search,
              onChange: setSearch,
              placeholder: "Search by model or regex rule",
              ariaLabel: "Search model costs",
            },
            lookup: {
              value: matchModel,
              onChange: setMatchModel,
              placeholder: "Which rule matches this model?",
              ariaLabel: "Which rule matches this model?",
            },
            filters: (
              <ProviderFilters
                provider={provider}
                onProvider={setProvider}
                customOnly={customOnly}
                onCustomOnly={setCustomOnly}
                providerCounts={providerCounts}
                total={rows.length}
              />
            ),
            onClearFilters: isFiltering ? clearFilters : void 0,
          }
        : void 0,
  } as const;
  const costsTable = (
    <ListTable scroll="x" scrollLabel="Model costs">
      <ListTable.Header>
        <ListTable.Row>
          <SortHeader
            label="Model name"
            sortKey="model"
            sort={sort}
            onSort={onSort}
            minWidth="160px"
          />
          <ListTable.ColumnHeader minWidth="160px">Regex match rule</ListTable.ColumnHeader>
          <SortHeader label="Input cost" sortKey="inputCostPerToken" sort={sort} onSort={onSort} />
          <SortHeader
            label="Output cost"
            sortKey="outputCostPerToken"
            sort={sort}
            onSort={onSort}
          />
          <ListTable.ColumnHeader>Cache read</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Cache write (5 min)</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Cache write (1 hour)</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Image input</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Image output</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {visibleRows.map((row) => (
          <ListTable.Row
            key={row.model}
            onActivate={() =>
              host.openPlatformDrawer({
                drawer: "llmModelCost",
                params: editorParams(row),
              })
            }
          >
            <ListTable.Cell>
              <ModelNameCell
                model={row.model}
                isCustom={!!row.updatedAt}
                modelProviderId={providerRows.get(providerOf(row))}
              />
            </ListTable.Cell>
            <ListTable.Cell>
              <RegexHighlight pattern={row.regex} />
            </ListTable.Cell>
            <RateCell rate={row.inputCostPerToken} isCustom={!!row.id} />
            <RateCell rate={row.outputCostPerToken} isCustom={!!row.id} />
            <RateCell rate={row.cacheReadCostPerToken} isCustom={!!row.id} />
            <RateCell rate={row.cacheCreationCostPerToken} isCustom={!!row.id} />
            <RateCell rate={row.cacheCreation1hCostPerToken} isCustom={!!row.id} />
            <RateCell rate={row.inputImageCostPerToken} isCustom={!!row.id} />
            <RateCell rate={row.outputImageCostPerToken} isCustom={!!row.id} />
            <ListTable.ActionCell>
              <ActionsMenu id={row.id} model={row.model} />
            </ListTable.ActionCell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );

  if (state === "empty") {
    return (
      <ListPage
        {...shared}
        state="empty"
        empty={{
          title: "No model costs",
          description: "Add a model to set what it costs per token.",
          icon: <Coins size={24} />,
          next: [COSTS_DOCS],
        }}
      >
        {costsTable}
      </ListPage>
    );
  }
  if (state === "no-results") {
    return (
      <ListPage
        {...shared}
        state="no-results"
        noResults={{
          description: "No models match. Try a different search or provider, or clear the filters.",
          onClear: clearFilters,
          next: [COSTS_DOCS],
        }}
      >
        {costsTable}
      </ListPage>
    );
  }
  return (
    <ListPage {...shared} state={state}>
      {costsTable}
    </ListPage>
  );
}

function ActionsMenu({ id, model }: { id?: string; model: string }) {
  const host = useModelProviderHost();
  const { projectId } = host.scope();
  const llmModelCosts = modelProviderApi.llmModelCost.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  const deleteLLMModelCost = modelProviderApi.llmModelCost.delete.useMutation();

  return (
    <Menu.Root>
      <Menu.Trigger minWidth={0} asChild>
        <Button variant="ghost" size="sm" aria-label={`Actions for ${model}`}>
          <MoreVertical size={16} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {!id && (
          <Menu.Item
            value="clone"
            onClick={(event) => {
              event.stopPropagation();
              host.openPlatformDrawer({
                drawer: "llmModelCost",
                params: { cloneModel: model },
              });
            }}
          >
            Override cost
          </Menu.Item>
        )}
        {id && (
          <Menu.Item
            value="edit"
            onClick={(event) => {
              event.stopPropagation();
              host.openPlatformDrawer({ drawer: "llmModelCost", params: { id } });
            }}
          >
            Edit
          </Menu.Item>
        )}
        {id && (
          <Menu.Item
            value="delete"
            color="red.fg"
            onClick={(event) => {
              event.stopPropagation();
              deleteLLMModelCost.mutate(
                { projectId: projectId ?? "", id },
                {
                  onSuccess: () => {
                    host.succeeded({
                      title: "Model cost deleted",
                    });
                    void llmModelCosts.refetch();
                  },
                  onError: (error) => {
                    // The application already put a refusal on screen via a global
                    // interceptor; toasting again would say it twice. Nothing above
                    // a package-served screen holds that interceptor yet, so
                    // `isReportedGlobally` answers false and the toast is the outcome either way.
                    if (host.isReportedGlobally(error)) return;
                    host.failed({ error, fallbackTitle: "Error deleting LLM model cost" });
                  },
                },
              );
            }}
          >
            Delete
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * Green marks a rate from a stored cost rule rather than the model catalogue. The `llmModelCost`
 * drawer stays registered outside this move — a trace's unmapped-cost suggestion opens it too.
 * Contract: specs/model-providers/model-cost-scoping.feature.
 */

import { formatMoney } from "@langwatch/design-system/format-money";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Button,
  Card,
  Code,
  HStack,
  NativeSelect,
  Skeleton,
  Spacer,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { ArrowDown, ArrowUp, ArrowUpDown, Coins, MoreVertical, Plus, SearchX } from "lucide-react";
import { useState } from "react";

import { modelProviderApi } from "../../behavior/model-provider-api.ts";
import { useAllModelProvidersList } from "../../behavior/use-all-model-providers-list.ts";
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

const exactRate = (rate: number) =>
  rate.toLocaleString("fullwide", { useGrouping: false, maximumSignificantDigits: 20 });

/** One rate as US dollars per million tokens; the exact per-token figure sits in the tooltip. */
function RateCell({ rate, isCustom }: { rate: number | undefined; isCustom: boolean }) {
  return (
    <Table.Cell padding={0}>
      {rate !== undefined && (
        <Tooltip content={`$${exactRate(rate)} per token`}>
          <Text
            as="span"
            display="inline-block"
            whiteSpace="nowrap"
            paddingX={3}
            textStyle="sm"
            fontVariantNumeric="tabular-nums"
            color={isCustom ? "green.fg" : undefined}
          >
            {formatMoney({ amount: rate * 1_000_000, currency: "USD" })}
            <Text as="span" color="fg.muted" textStyle="xs">
              {" "}
              / 1M
            </Text>
          </Text>
        </Tooltip>
      )}
    </Table.Cell>
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

const SORT_ICONS = { asc: ArrowUp, desc: ArrowDown } as const;
const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

function SortHeader(props: {
  label: string;
  sortKey: ModelCostSortKey;
  sort: ModelCostSort | null;
  onSort: (key: ModelCostSortKey) => void;
  minWidth?: string;
}) {
  const active = props.sort?.key === props.sortKey ? props.sort.direction : null;
  const Icon = active ? SORT_ICONS[active] : ArrowUpDown;
  return (
    <Table.ColumnHeader
      minWidth={props.minWidth}
      whiteSpace="nowrap"
      aria-sort={active ? ARIA_SORT[active] : "none"}
    >
      <Button size="xs" variant="ghost" onClick={() => props.onSort(props.sortKey)}>
        {props.label}
        <Icon size={12} />
      </Button>
    </Table.ColumnHeader>
  );
}

function countLine(args: { loaded: boolean; isFiltering: boolean; shown: number; total: number }) {
  if (!args.loaded) return "What each model costs per token.";
  if (args.isFiltering) return `Showing ${args.shown} of ${args.total} models.`;
  return `What each of the ${args.total} models costs per token.`;
}

function FilterBar(props: {
  search: string;
  onSearch: (value: string) => void;
  matchModel: string;
  onMatchModel: (value: string) => void;
  provider: string;
  onProvider: (value: string) => void;
  customOnly: boolean;
  onCustomOnly: (value: boolean) => void;
  providerCounts: Map<string, number>;
  total: number;
  isFiltering: boolean;
  onClear: () => void;
}) {
  return (
    <HStack width="full" gap={3} wrap="wrap">
      <SearchInput
        maxWidth="320px"
        placeholder="Search by model or regex rule"
        aria-label="Search model costs"
        value={props.search}
        onChange={(event) => props.onSearch(event.target.value)}
      />
      <SearchInput
        maxWidth="320px"
        placeholder="Which rule matches this model?"
        aria-label="Which rule matches this model?"
        value={props.matchModel}
        onChange={(event) => props.onMatchModel(event.target.value)}
      />
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
      {props.isFiltering && (
        <Button size="sm" variant="ghost" onClick={props.onClear}>
          Clear filters
        </Button>
      )}
    </HStack>
  );
}

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

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Model Costs</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton
          primary
          data-testid="add-model-cost"
          onClick={() => host.openPlatformDrawer({ drawer: "llmModelCost" })}
          disabled={!host.hasPermission(MODEL_COST_MANAGE_PERMISSION)}
        >
          <Plus size={14} />
          Add New Model
        </PageLayout.HeaderButton>
      </PageLayout.Header>
      <VStack width="full" gap={6} align="start" paddingTop={4}>
        <Text color="fg.muted">
          {countLine({
            loaded: !!llmModelCosts.data,
            isFiltering,
            shown: visibleRows.length,
            total: rows.length,
          })}
        </Text>
        {rows.length > 0 && (
          <FilterBar
            search={search}
            onSearch={setSearch}
            matchModel={matchModel}
            onMatchModel={setMatchModel}
            provider={provider}
            onProvider={setProvider}
            customOnly={customOnly}
            onCustomOnly={setCustomOnly}
            providerCounts={providerCounts}
            total={rows.length}
            isFiltering={isFiltering}
            onClear={clearFilters}
          />
        )}
        {noCosts && (
          <NoDataInfoBlock
            title="No model costs"
            description="Add a model to set what it costs per token"
            icon={<Coins size={24} />}
          />
        )}
        {noMatches && (
          <NoDataInfoBlock
            title="No models match"
            description="Try a different search or provider, or clear the filters."
            icon={<SearchX size={24} />}
          >
            <Button size="sm" variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          </NoDataInfoBlock>
        )}
        {!noCosts && !noMatches && (
          <Card.Root width="full" overflow="hidden">
            <Card.Body padding={0} overflowX="auto">
              <Table.Root variant="line" width="full" maxWidth="100%">
                <Table.Header width="full">
                  <Table.Row width="full">
                    <SortHeader
                      label="Model name"
                      sortKey="model"
                      sort={sort}
                      onSort={onSort}
                      minWidth="160px"
                    />
                    <Table.ColumnHeader minWidth="160px">Regex match rule</Table.ColumnHeader>
                    <SortHeader
                      label="Input cost"
                      sortKey="inputCostPerToken"
                      sort={sort}
                      onSort={onSort}
                    />
                    <SortHeader
                      label="Output cost"
                      sortKey="outputCostPerToken"
                      sort={sort}
                      onSort={onSort}
                    />
                    <Table.ColumnHeader whiteSpace="nowrap">Cache read</Table.ColumnHeader>
                    <Table.ColumnHeader whiteSpace="nowrap">
                      Cache write (5 minutes)
                    </Table.ColumnHeader>
                    <Table.ColumnHeader whiteSpace="nowrap">
                      Cache write (1 hour)
                    </Table.ColumnHeader>
                    <Table.ColumnHeader whiteSpace="nowrap">Image input</Table.ColumnHeader>
                    <Table.ColumnHeader whiteSpace="nowrap">Image output</Table.ColumnHeader>
                    <Table.ColumnHeader width="64px" padding={1} />
                  </Table.Row>
                </Table.Header>
                <Table.Body width="full">
                  {llmModelCosts.isLoading &&
                    Array.from({ length: 3 }).map((_, rowIndex) => (
                      <Table.Row key={rowIndex}>
                        {Array.from({ length: 9 }).map((__, cellIndex) => (
                          <Table.Cell key={cellIndex}>
                            <Skeleton height="20px" />
                          </Table.Cell>
                        ))}
                        <Table.Cell padding={1} />
                      </Table.Row>
                    ))}
                  {visibleRows.map((row) => (
                    <Table.Row
                      key={row.model}
                      width="full"
                      cursor="pointer"
                      _hover={{ bg: "bg.muted" }}
                      onClick={() =>
                        host.openPlatformDrawer({
                          drawer: "llmModelCost",
                          params: editorParams(row),
                        })
                      }
                    >
                      <Table.Cell>
                        <ModelNameCell
                          model={row.model}
                          isCustom={!!row.updatedAt}
                          modelProviderId={providerRows.get(providerOf(row))}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <RegexHighlight pattern={row.regex} />
                      </Table.Cell>
                      <RateCell rate={row.inputCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.outputCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.cacheReadCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.cacheCreationCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.cacheCreation1hCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.inputImageCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.outputImageCostPerToken} isCustom={!!row.id} />
                      <Table.Cell padding={1} onClick={(event) => event.stopPropagation()}>
                        <ActionsMenu id={row.id} model={row.model} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card.Body>
          </Card.Root>
        )}
      </VStack>
    </>
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
            color="red.600"
            onClick={(event) => {
              event.stopPropagation();
              deleteLLMModelCost.mutate(
                { projectId: projectId ?? "", id },
                {
                  onSuccess: () => {
                    host.succeeded({
                      title: "Success",
                      description: "LLM model cost deleted successfully",
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

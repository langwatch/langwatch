import {
  Box,
  Button,
  Field,
  HStack,
  Heading,
  Input,
  Skeleton,
  Spacer,
  Tag,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { cloneDeep } from "lodash";
import numeral from "numeral";
import React, { useEffect } from "react";
import { ChevronDown, Search, X } from "react-feather";
import { useDebounceValue } from "usehooks-ts";
import { useDrawer } from "~/components/CurrentDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useFilterParams, type FilterParam } from "../../hooks/useFilterParams";
import { TeamRoleGroup } from "../../server/api/permission";
import type { AppRouter } from "../../server/api/root";
import { availableFilters } from "../../server/filters/registry";
import type { FilterDefinition, FilterField } from "../../server/filters/types";
import { api } from "../../utils/api";
import { Popover } from "../ui/popover";
import { Checkbox } from "../ui/checkbox";
import { Tooltip } from "../ui/tooltip";
import { useColorRawValue } from "../ui/color-mode";
import { InputGroup } from "../ui/input-group";
import { Slider } from "../ui/slider";

export function FieldsFilters() {
  const { nonEmptyFilters } = useFilterParams();
  const { openDrawer, drawerOpen: isDrawerOpen } = useDrawer();
  const { hasTeamPermission } = useOrganizationTeamProject();

  const isEditMode = isDrawerOpen("editTriggerFilter");

  const filterKeys: FilterField[] = [
    "spans.model",
    "metadata.labels",
    "evaluations.passed",
    "evaluations.score",
    "evaluations.label",
    "events.metrics.value",
    "metadata.user_id",
    "metadata.thread_id",
    "metadata.customer_id",
    "metadata.value",
    "evaluations.state",
    "traces.error",
    "annotations.hasAnnotation",
  ];

  const filters: [FilterField, FilterDefinition][] = filterKeys.map((id) => [
    id,
    availableFilters[id],
  ]);

  const hasAnyFilters = nonEmptyFilters.length > 0;

  return (
    <VStack align="start" width="300px" gap={6}>
      <HStack width={"full"}>
        <Heading size="md">Filters</Heading>

        <Spacer />

        {hasTeamPermission(TeamRoleGroup.TRIGGERS_MANAGE) && !isEditMode && (
          <Tooltip content="Create a filter to add a trigger.">
            <Button
              colorPalette="orange"
              onClick={() => openDrawer("trigger", undefined)}
              disabled={!hasAnyFilters}
            >
              Add Trigger
            </Button>
          </Tooltip>
        )}
      </HStack>
      <VStack gap={3} width="full">
        {filters.map(([id, filter]) => (
          <FieldsFilter key={id} filterId={id} filter={filter} />
        ))}
      </VStack>
    </VStack>
  );
}

function FieldsFilter({
  filterId,
  filter,
}: {
  filterId: FilterField;
  filter: FilterDefinition;
}) {
  const gray400 = useColorRawValue("gray.400");

  const { setFilter, filters } = useFilterParams();

  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useDebounceValue("", 300);
  const { open, setOpen } = useDisclosure();
  const current = filters[filterId] ?? [];

  const currentStringList = Array.isArray(current)
    ? current
    : Object.keys(current);

  return (
    <Field.Root>
      <Popover.Root
        positioning={{ placement: "bottom" }}
        open={open}
        onOpenChange={({ open }) => setOpen(open)}
      >
        <Popover.Trigger asChild>
          <Button
            variant="outline"
            size="md"
            width="100%"
            background="white"
            fontWeight="normal"
            _hover={{ background: "white" }}
          >
            <HStack width="full" gap={1}>
              <Text color="gray.500" fontWeight="500" paddingRight={4}>
                {filter.name}
              </Text>
              {currentStringList.length > 0 ? (
                <>
                  <Text lineClamp={1}>{currentStringList.join(", ")}</Text>
                  <Spacer />
                  {currentStringList.length > 1 && (
                    <Tag.Root
                      justifyContent="center"
                      display="flex"
                      flexShrink={0}
                    >
                      <Tag.Label>{currentStringList.length}</Tag.Label>
                    </Tag.Root>
                  )}
                  <Tooltip
                    content={`Clear ${filter.name.toLowerCase()} filter`}
                  >
                    <Button
                      as={Box}
                      role="button"
                      variant="plain"
                      width="fit-content"
                      display="flex"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilter(filterId, []);
                      }}
                    >
                      <X width={12} />
                    </Button>
                  </Tooltip>
                </>
              ) : (
                <>
                  <Text color="gray.400">Any</Text>
                  <Spacer />
                </>
              )}
              <ChevronDown />
            </HStack>
          </Button>
        </Popover.Trigger>
        <Popover.Content>
          <Popover.Header paddingY={1} paddingX={1}>
            <InputGroup
              width="full"
              startElement={<Search width={16} color={gray400} />}
            >
              <Input
                width="full"
                placeholder="Search..."
                border="none"
                ref={searchRef}
                _focusVisible={{ boxShadow: "none" }}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
              />
            </InputGroup>
          </Popover.Header>
          <Popover.Body paddingY={1} paddingX={4}>
            {open && (
              <NestedListSelection
                query={query}
                current={current}
                keysAhead={[
                  ...(filter.requiresKey ? [filter.requiresKey.filter] : []),
                  ...(filter.requiresSubkey
                    ? [filter.requiresSubkey.filter]
                    : []),
                  filterId,
                ]}
              />
            )}
          </Popover.Body>
        </Popover.Content>
      </Popover.Root>
    </Field.Root>
  );
}

function NestedListSelection({
  query,
  current,
  keysAhead,
  keysBefore = [],
}: {
  query: string;
  current: FilterParam;
  keysAhead: FilterField[];
  keysBefore?: string[];
}) {
  const { setFilter } = useFilterParams();

  const filterId = keysAhead[0];
  if (!filterId) {
    console.warn("NestedListSelection called with empty keysAhead");
    return null;
  }

  let currentValues = current;
  keysBefore.forEach((key) => {
    if (!Array.isArray(currentValues)) {
      currentValues = currentValues[key] ?? [];
    }
  });
  if (!Array.isArray(currentValues)) {
    currentValues = Object.keys(currentValues);
  }

  return (
    <ListSelection
      filterId={filterId}
      query={query}
      currentValues={currentValues}
      keys={keysBefore}
      onChange={(values) => {
        const topLevelFilterId = keysAhead[keysAhead.length - 1]!;
        if (keysAhead.length === 1 && keysBefore.length == 0) {
          setFilter(topLevelFilterId, values);
          return;
        }

        const filterParam = Array.isArray(current) ? {} : cloneDeep(current);
        let current_ = filterParam;
        keysBefore
          .slice(0, keysAhead.length + keysBefore.length - 2)
          .forEach((key) => {
            const next = current_[key];
            if (next) {
              if (Array.isArray(next)) {
                current_[key] = {} as Record<string, string[]>;
                current_ = current_[key] as any;
              } else {
                current_ = next;
              }
            }
          });

        const lastKey = keysBefore[keysBefore.length - 1]!;
        if (keysAhead.length === 1) {
          current_[lastKey] = values;
        } else {
          for (const key of Object.keys(current_)) {
            if (!(key in values)) {
              delete current_[key];
            }
          }
          for (const key of values) {
            if (!current_[key]) {
              current_[key] = [];
            }
          }
          if (lastKey && Object.keys(current_).length === 0) {
            current_[lastKey] = [];
          }
        }

        setFilter(topLevelFilterId, filterParam);
      }}
      {...(keysAhead.length > 1
        ? {
            nested: (key) => {
              return (
                <NestedListSelection
                  query={query}
                  current={current}
                  keysAhead={keysAhead.slice(1)}
                  keysBefore={[...keysBefore, key]}
                />
              );
            },
          }
        : {})}
    />
  );
}

function ListSelection({
  filterId,
  query,
  keys,
  currentValues,
  onChange,
  nested,
}: {
  filterId: FilterField;
  query: string;
  keys?: string[];
  currentValues: string[];
  onChange: (value: string[]) => void;
  nested?: (key: string) => React.ReactNode;
}) {
  const filter = availableFilters[filterId];

  const { filterParams, queryOpts } = useFilterParams();
  const filterData = api.analytics.dataForFilter.useQuery(
    {
      ...filterParams,
      field: filterId,
      key: keys?.[0],
      subkey: keys?.[1],
    },
    {
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      keepPreviousData: true,
      enabled: queryOpts.enabled,
    }
  );

  if (
    filter.type === "numeric" &&
    keys?.[0] == "thumbs_up_down" &&
    keys?.[1] == "vote"
  ) {
    return (
      <ThumbsUpDownVoteFilter
        currentValues={currentValues}
        onChange={onChange}
      />
    );
  }

  if (filter.type === "numeric") {
    return (
      <RangeFilter
        filterData={filterData}
        currentValues={currentValues}
        onChange={onChange}
      />
    );
  }

  return (
    <VStack
      width="full"
      align="start"
      gap={2}
      paddingY={2}
      maxHeight="300px"
      overflowY="scroll"
      className="js-filter-popover"
    >
      {filterData.data?.options
        .sort((a, b) => (a.count > b.count ? -1 : 1))
        .filter((option) => {
          if (query) {
            return option.label.toLowerCase().includes(query.toLowerCase());
          }
          return true;
        })
        .map(({ field, label, count }) => {
          let details = "";
          const labelDetailsMatch = label.match(/^\[(.*)\] (.*)/);
          if (labelDetailsMatch) {
            label = labelDetailsMatch[2] ?? "";
            details = labelDetailsMatch[1] ?? "";
          }

          const onChange_ = (e: any) => {
            e.preventDefault();
            e.stopPropagation();

            if (currentValues.includes(field.toString())) {
              onChange(
                currentValues.filter((v) => v.toString() !== field.toString())
              );
            } else {
              onChange([...currentValues, field]);
            }
          };

          return (
            <React.Fragment key={field}>
              <HStack width="full">
                <Checkbox
                  width="full"
                  paddingY={1}
                  gap={3}
                  checked={currentValues.includes(field.toString())}
                  onClick={onChange_}
                  onChange={onChange_}
                >
                  <VStack width="full" align="start" gap={"2px"}>
                    {details && (
                      <Text fontSize="sm" color="gray.500">
                        {details}
                      </Text>
                    )}
                    <Text>{label === "" ? "<empty>" : label}</Text>
                  </VStack>
                </Checkbox>
                <Spacer />
                {typeof count !== "undefined" && (
                  <Text fontSize="13px" color="gray.400">
                    {count}
                  </Text>
                )}
              </HStack>
              <Box width="full" paddingLeft={4}>
                {nested && currentValues.includes(field) && nested(field)}
              </Box>
            </React.Fragment>
          );
        })}
      {filterData.data && filterData.data.options.length === 0 && (
        <Text>No options found</Text>
      )}
      {filterData.isLoading &&
        Array.from({ length: keys && keys.length > 0 ? 2 : 5 }).map((_, i) => (
          <Checkbox
            key={i}
            checked={false}
            paddingY={2}
            gap={3}
            onChange={() => void 0}
          >
            <Skeleton height="12px" width="120px" />
          </Checkbox>
        ))}
    </VStack>
  );
}

function RangeFilter({
  filterData,
  currentValues,
  onChange,
}: {
  filterData: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["analytics"]["dataForFilter"],
    TRPCClientErrorLike<AppRouter>
  >;
  currentValues: string[];
  onChange: (value: string[]) => void;
}) {
  let min = +numeral(
    +(filterData.data?.options.find((o) => o.label === "min")?.field ?? 0)
  ).format("0.[0]");
  let max = +numeral(
    +(filterData.data?.options.find((o) => o.label === "max")?.field ?? 0)
  ).format("0.[0]");
  if (isNaN(min)) {
    min = 0;
  }
  if (isNaN(max)) {
    max = 1;
  }
  if (min === max && min === 0) {
    min = 0;
    max = 1;
  }
  if (min === max && min !== 0) {
    min = 0;
  }

  useEffect(() => {
    if (filterData.data) {
      onChange([min.toString(), max.toString()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, !!filterData.data]);

  return (
    <HStack width="full" gap={4}>
      <Input
        width="72px"
        paddingX={2}
        textAlign="center"
        value={currentValues[0]}
        onChange={(e) => {
          onChange([e.target.value, currentValues[1] ?? max.toString()]);
        }}
      />
      <Slider.Root
        min={min}
        max={max}
        step={0.1}
        value={
          currentValues && currentValues.length == 2
            ? currentValues?.map((v) => +v)
            : [min, max]
        }
        onValueChange={(values) => {
          onChange(values.value.map((v) => v.toString()));
        }}
        colorPalette="orange"
      >
        <Slider.Control>
          <Slider.Track>
            <Slider.Range />
          </Slider.Track>
          <Slider.Thumb index={0}>
            <Slider.HiddenInput />
          </Slider.Thumb>
          <Slider.Thumb index={1}>
            <Slider.HiddenInput />
          </Slider.Thumb>
        </Slider.Control>
      </Slider.Root>
      <Input
        width="72px"
        paddingX={2}
        textAlign="center"
        value={currentValues[1]}
        onChange={(e) => {
          onChange([currentValues[0] ?? min.toString(), e.target.value]);
        }}
      />
    </HStack>
  );
}

function ThumbsUpDownVoteFilter({
  currentValues,
  onChange,
}: {
  currentValues: string[];
  onChange: (value: string[]) => void;
}) {
  const min = currentValues[0] ? +currentValues[0] : undefined;
  const max = currentValues[1] ? +currentValues[1] : undefined;

  return (
    <VStack
      width="full"
      align="start"
      gap={2}
      paddingY={2}
      maxHeight="300px"
      overflowY="scroll"
      className="js-filter-popover"
    >
      {[
        { field: -1, label: "negative" },
        { field: 1, label: "positive" },
      ].map(({ field, label }) => (
        <Checkbox
          key={field}
          width="full"
          paddingY={1}
          gap={3}
          checked={!!(min && max && min <= field && max >= field)}
          onChange={(e) => {
            e.stopPropagation();
            if (e.target.checked) {
              onChange([
                (min && min < field ? min : field).toString(),
                (max && max > field ? max : field).toString(),
              ]);
            } else {
              const other = field === -1 ? 1 : -1;
              onChange([
                ((min ?? 0) === field && (max ?? 0) === field
                  ? undefined
                  : other
                )?.toString() ?? "",
                ((min ?? 0) === field && (max ?? 0) === field
                  ? undefined
                  : other
                )?.toString() ?? "",
              ]);
            }
          }}
        >
          <VStack width="full" align="start" gap={"2px"}>
            <Text>{label}</Text>
          </VStack>
        </Checkbox>
      ))}
    </VStack>
  );
}

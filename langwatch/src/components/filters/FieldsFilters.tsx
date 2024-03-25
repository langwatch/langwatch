import {
  Box,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  RangeSlider,
  RangeSliderFilledTrack,
  RangeSliderThumb,
  RangeSliderTrack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Select as MultiSelect,
  chakraComponents,
  type MultiValue,
  type SingleValue,
} from "chakra-react-select";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { FilterDefinition, FilterField } from "../../server/filters/types";
import { api } from "../../utils/api";
import { availableFilters } from "../../server/filters/registry";
import React from "react";
import { Check } from "react-feather";
import numeral from "numeral";

export function FieldsFilters() {
  const router = useRouter();

  const filterKeys: FilterField[] = [
    "spans.model",
    "metadata.labels",
    "trace_checks.passed",
    "trace_checks.score",
    "trace_checks.state",
    "events.metrics.value",
    "metadata.user_id",
    "metadata.thread_id",
    "metadata.customer_id",
  ];

  const filters: [FilterField, FilterDefinition][] = filterKeys.map((key) => [
    key,
    availableFilters[key],
  ]);

  const addFilterToUrl = useAddFilterToUrl();

  return (
    <VStack align="start" width="full" spacing={6}>
      <Heading size="md">Filters</Heading>
      <VStack spacing={4} width="full">
        {filters.map(([key, filter]) => {
          const requiredKeyFilter = filter.requiresKey
            ? availableFilters[filter.requiresKey.filter]
            : undefined;
          const requiredKeyUrl = requiredKeyFilter
            ? `${filter.urlKey}_key`
            : undefined;
          const currentKeyValue = requiredKeyUrl
            ? (router.query[requiredKeyUrl] as string)?.split(",")?.[0]
            : undefined;

          const requiredSubkeyFilter = filter.requiresSubkey
            ? availableFilters[filter.requiresSubkey.filter]
            : undefined;
          const requiredSubkeyUrl = requiredSubkeyFilter
            ? `${filter.urlKey}_subkey`
            : undefined;
          const currentSubkeyValue = requiredSubkeyUrl
            ? (router.query[requiredSubkeyUrl] as string)?.split(",")?.[0]
            : undefined;

          return (
            <FormControl key={key}>
              <FormLabel>{filter.name}</FormLabel>
              <HStack flexWrap={filter.type === "numeric" ? "wrap" : undefined}>
                {requiredKeyFilter && (
                  <NestedKeyField
                    filter={filter}
                    requiredKey={filter.requiresKey!.filter}
                    requiredKeyUrl={requiredKeyUrl!}
                    currentKeyValue={currentKeyValue!}
                  />
                )}
                {requiredSubkeyFilter && (
                  <NestedKeyField
                    filter={filter}
                    requiredKey={filter.requiresSubkey!.filter}
                    requiredKeyUrl={requiredSubkeyUrl!}
                    currentKeyValue={currentSubkeyValue!}
                    key_={requiredKeyFilter ? currentKeyValue : undefined}
                    isDisabled={!!requiredKeyFilter && !currentKeyValue}
                  />
                )}
                <FilterSelectField
                  current={
                    (router.query[filter.urlKey] as string)?.split(",") ?? []
                  }
                  onChange={(value) => {
                    addFilterToUrl([
                      { param: filter.urlKey, value: value.join(",") },
                    ]);
                  }}
                  filter={key}
                  key_={requiredKeyFilter ? currentKeyValue : undefined}
                  subkey={requiredSubkeyFilter ? currentSubkeyValue : undefined}
                  isDisabled={
                    (!!requiredKeyFilter && !currentKeyValue) ||
                    (!!requiredSubkeyFilter && !currentSubkeyValue)
                  }
                  single={!!filter.single}
                  emptyOption={filter.single ? "Select..." : undefined}
                />
              </HStack>
            </FormControl>
          );
        })}
      </VStack>
    </VStack>
  );
}

const useAddFilterToUrl = () => {
  const router = useRouter();

  return (filters: { param: string; value: string }[]) => {
    void router.push(
      {
        query: {
          ...router.query,
          ...Object.fromEntries(
            filters.map(({ param, value }) => [param, value])
          ),
        },
      },
      undefined,
      { shallow: true, scroll: false }
    );
  };
};

function NestedKeyField({
  filter,
  requiredKey,
  requiredKeyUrl,
  currentKeyValue,
  key_,
  isDisabled = false,
}: {
  filter: FilterDefinition;
  requiredKey: FilterField;
  requiredKeyUrl: string;
  currentKeyValue: string;
  key_?: string;
  isDisabled?: boolean;
}) {
  const addFilterToUrl = useAddFilterToUrl();

  return (
    <FilterSelectField
      single={true}
      current={currentKeyValue ? [currentKeyValue] : []}
      onChange={(value) => {
        addFilterToUrl([
          {
            param: requiredKeyUrl,
            value: value.join(","),
          },
          ...(value.join(",").length === 0
            ? [
                {
                  param: filter.urlKey,
                  value: "",
                },
              ]
            : []),
        ]);
      }}
      filter={requiredKey}
      emptyOption={"Select..."}
      key_={key_}
      isDisabled={isDisabled}
    />
  );
}

const FilterSelectField = React.memo(function FilterSelectField({
  onChange,
  key_,
  subkey,
  filter,
  emptyOption,
  current,
  isDisabled = false,
  single = false,
}: {
  onChange: (value: string[]) => void;
  key_?: string;
  subkey?: string;
  filter: FilterField;
  emptyOption?: string;
  current?: string[];
  isDisabled?: boolean;
  single?: boolean;
}) {
  const { project } = useOrganizationTeamProject();
  const [query, setQuery] = useState("");
  const filterData = api.analytics.dataForFilter.useQuery(
    {
      projectId: project?.id ?? "",
      field: filter,
      key: key_,
      subkey: subkey,
      query: query,
    },
    {
      enabled: !!project && !isDisabled,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );

  const [options, current_] = useMemo(() => {
    const emptyOption_ =
      typeof emptyOption !== "undefined"
        ? [{ value: "", label: emptyOption }]
        : [];

    const options: { value: string; label: string; count?: number }[] =
      emptyOption_.concat(
        filterData.data?.options.map(({ field, label, count }) => ({
          value: field?.toString() ?? "0",
          label,
          count,
        })) ?? []
      );

    const current_ = options.filter(
      (option) => current?.includes(option.value)
    );

    return [options, current_];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(current), emptyOption, filterData.data?.options]);

  const isNumeric = availableFilters[filter].type === "numeric";

  const min = +numeral(
    +(filterData.data?.options.find((o) => o.label === "min")?.field ?? 0)
  ).format("0.[0]");
  const max = +numeral(
    +(filterData.data?.options.find((o) => o.label === "max")?.field ?? 0)
  ).format("0.[0]");

  useEffect(() => {
    if (isNumeric && filterData.data) {
      onChange([min.toString(), max.toString()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max]);

  if (isNumeric) {
    return (
      <HStack width="100%" paddingX={4}>
        <RangeSlider
          isDisabled={isDisabled}
          colorScheme="orange"
          // eslint-disable-next-line jsx-a11y/aria-proptypes
          aria-label={["min", "max"]}
          min={min}
          max={max}
          step={0.1}
          value={
            current && current.length == 2
              ? current?.map((v) => +v)
              : [min, max]
          }
          onChange={(values) => {
            onChange(values.map((v) => v.toString()));
          }}
        >
          <RangeSliderTrack>
            <RangeSliderFilledTrack />
          </RangeSliderTrack>
          <RangeSliderThumb index={0} padding={3}>
            <Text fontSize={13}>{current?.[0]}</Text>
          </RangeSliderThumb>
          <RangeSliderThumb index={1} padding={3}>
            <Text fontSize={13}>{current?.[1]}</Text>
          </RangeSliderThumb>
        </RangeSlider>
      </HStack>
    );
  }

  return (
    <MultiSelect
      key={filter}
      hideSelectedOptions={false}
      closeMenuOnSelect={single}
      isDisabled={isDisabled}
      //@ts-ignore
      onChange={(
        options:
          | MultiValue<{ value: string; label: string; count?: number }>
          | SingleValue<{ value: string; label: string; count?: number }>
      ) => {
        if (Array.isArray(options)) {
          onChange(options.map((o) => o.value));
        } else if (options) {
          onChange([(options as any).value]);
        }

        return true;
      }}
      isLoading={!isDisabled && filterData.isLoading}
      onInputChange={(input) => {
        setQuery(input);
      }}
      options={options}
      value={current_}
      isSearchable={true}
      isMulti={!single}
      useBasicStyles
      placeholder="Select..."
      chakraStyles={{
        container: (base) => ({
          ...base,
          background: "white",
          width: "100%",
          minWidth: "50%",
          borderRadius: "5px",
        }),
      }}
      components={{
        Option: ({ ...props }) => {
          const data = props.data as {
            value: string;
            label: string;
            count?: number;
          };
          let label = data.label;
          let details = "";
          // const count = (props.data as any).count;
          // if label is like "[details] label" then split it
          const labelDetailsMatch = data.label.match(/^\[(.*)\] (.*)/);
          if (labelDetailsMatch) {
            label = labelDetailsMatch[2] ?? "";
            details = labelDetailsMatch[1] ?? "";
          }

          return (
            <chakraComponents.Option {...props} className="multicheck-option">
              <HStack width="full" align="end">
                <Box width="16px">
                  {props.isSelected && <Check width="16px" />}
                </Box>
                <VStack width="full" align="start" spacing={"2px"}>
                  {details && (
                    <Text fontSize="sm" color="gray.500">
                      {details}
                    </Text>
                  )}
                  <HStack width="full">
                    <Text color={data.value === "" ? "gray.400" : undefined}>
                      {label}
                    </Text>
                    <Spacer />
                    {/* TODO: this is hidden for now because we need to send also the date range, and other filters, to apply the rules */}
                    {/* {typeof count !== "undefined" && (
                      <Text fontSize={13} color="gray.400">
                        {count}
                      </Text>
                    )} */}
                  </HStack>
                </VStack>
              </HStack>
            </chakraComponents.Option>
          );
        },
      }}
    />
  );
});

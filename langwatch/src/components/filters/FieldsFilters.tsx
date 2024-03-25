import {
  Box,
  FormControl,
  FormLabel,
  HStack,
  Heading,
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
import { useMemo, useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { FilterDefinition, FilterField } from "../../server/filters/types";
import { api } from "../../utils/api";
import { availableFilters } from "../../server/filters/registry";
import React from "react";
import { Check } from "react-feather";

export function FieldsFilters() {
  const router = useRouter();

  const filterKeys: FilterField[] = [
    "spans.model",
    "metadata.labels",
    "trace_checks.passed",
    "trace_checks.state",
    "events.event_type",
    "metadata.user_id",
    "metadata.thread_id",
    "metadata.customer_id",
  ];

  const filters: [FilterField, FilterDefinition][] = filterKeys.map((key) => [
    key,
    availableFilters[key],
  ]);

  const addFilterToUrl = (filters: { param: string; value: string }[]) => {
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

  return (
    <VStack align="start" width="full" spacing={6}>
      <Heading size="md">Filters</Heading>
      <VStack spacing={4} width="full">
        {filters.map(([key, filter]) => {
          const requiredField = filter.requiresKey
            ? availableFilters[filter.requiresKey.filter]
            : undefined;

          const requiredFieldKey = filter.requiresKey?.filter;

          const requiredFieldUrlKey = requiredField
            ? `${filter.urlKey}_key`
            : undefined;

          const currentRequiredKeyValue = requiredFieldUrlKey
            ? (router.query[requiredFieldUrlKey] as string)?.split(",")?.[0]
            : undefined;

          return (
            <FormControl key={key}>
              <FormLabel>{filter.name}</FormLabel>
              <HStack>
                {requiredField && (
                  <FilterSelectField
                    single={true}
                    current={
                      currentRequiredKeyValue ? [currentRequiredKeyValue] : []
                    }
                    onChange={(value) => {
                      addFilterToUrl([
                        {
                          param: requiredFieldUrlKey!,
                          value: value.join(","),
                        },
                        ...(value.length === 0
                          ? [
                              {
                                param: filter.urlKey,
                                value: "",
                              },
                            ]
                          : []),
                      ]);
                    }}
                    filter={requiredFieldKey!}
                    emptyOption={"Select..."}
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
                  key_={requiredField ? currentRequiredKeyValue : undefined}
                  isDisabled={!!requiredField && !currentRequiredKeyValue}
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

const FilterSelectField = React.memo(function FilterSelectField({
  onChange,
  key_,
  filter,
  emptyOption,
  current,
  isDisabled = false,
  single = false,
}: {
  onChange: (value: string[]) => void;
  key_?: string;
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
          value: field.toString(),
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
          const count = (props.data as any).count;
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

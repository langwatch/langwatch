import {
  Box,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Select as MultiSelect,
  chakraComponents,
  type MultiValue,
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
    "trace_checks.check_id",
    "events.event_type",
    "metadata.user_id",
    "metadata.thread_id",
    "metadata.customer_id",
  ];

  const filters: [FilterField, FilterDefinition][] = filterKeys.map((key) => [
    key,
    availableFilters[key],
  ]);

  const addFilterToUrl = (field: string, value: string) => {
    void router.push(
      {
        query: {
          ...router.query,
          [field]: value,
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
        {filters.map(([key, filter]) => (
          <FormControl key={key}>
            <FormLabel>{filter.name}</FormLabel>
            <FilterSelectField
              current={
                (router.query[filter.urlKey] as string)?.split(",") ?? []
              }
              onChange={(value) => {
                addFilterToUrl(filter.urlKey, value.join(","));
              }}
              filter={key}
            />
          </FormControl>
        ))}
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
}: {
  onChange: (value: string[]) => void;
  key_?: string;
  filter: FilterField;
  emptyOption?: string;
  current?: string[];
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
      enabled: !!project,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );

  const [options, current_] = useMemo(() => {
    const emptyOption_ = emptyOption ? [{ value: "", label: emptyOption }] : [];

    const options: { value: string; label: string }[] = emptyOption_.concat(
      filterData.data?.options.map(({ field, label }) => ({
        value: field,
        label,
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
      closeMenuOnSelect={false}
      onChange={(options: MultiValue<{ value: string; label: string }>) => {
        if (options) {
          onChange(options.map((o) => o.value));
        }

        return true;
      }}
      isLoading={filterData.isLoading}
      onInputChange={(input) => {
        setQuery(input);
      }}
      options={options as any}
      value={current_}
      isSearchable={true}
      isMulti={true}
      useBasicStyles
      components={{
        Option: ({ ...props }) => {
          let label = props.data.label;
          let details = "";
          // if label is like "[details] label" then split it
          const labelDetailsMatch = props.data.label.match(/^\[(.*)\] (.*)/);
          if (labelDetailsMatch) {
            label = labelDetailsMatch[2] ?? "";
            details = labelDetailsMatch[1] ?? "";
          }

          return (
            <chakraComponents.Option {...props} className="multicheck-option">
              <HStack align="end">
                <Box width="16px">
                  {props.isSelected && <Check width="16px" />}
                </Box>
                <VStack align="start" spacing={"2px"}>
                  {details && (
                    <Text fontSize="sm" color="gray.500">
                      {details}
                    </Text>
                  )}
                  <Text>{label}</Text>
                </VStack>
              </HStack>
            </chakraComponents.Option>
          );
        },
        SelectContainer: ({ children, ...props }) => (
          <chakraComponents.SelectContainer
            {...props}
            innerProps={{
              ...props.innerProps,
              style: { width: "100%", background: "white" },
            }}
          >
            {children}
          </chakraComponents.SelectContainer>
        ),
      }}
    />
  );
});

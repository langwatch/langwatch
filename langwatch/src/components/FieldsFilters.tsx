import { FormControl, FormLabel, Heading, VStack } from "@chakra-ui/react";
import {
  Select as MultiSelect,
  chakraComponents,
  type MultiValue,
} from "chakra-react-select";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import type { FilterField } from "../server/filters/types";
import { api } from "../utils/api";

export function FieldsFilters() {
  const router = useRouter();

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
        <FormControl>
          <FormLabel>User ID</FormLabel>
          <FilterSelectField
            current={(router.query.user_id as string)?.split(",") ?? []}
            onChange={(user_ids) => {
              addFilterToUrl("user_id", user_ids.join(","));
            }}
            filter="metadata.user_id"
          />
        </FormControl>
        <FormControl>
          <FormLabel>Thread ID</FormLabel>
          <FilterSelectField
            current={(router.query.thread_id as string)?.split(",") ?? []}
            onChange={(thread_ids) => {
              addFilterToUrl("thread_id", thread_ids.join(","));
            }}
            filter="metadata.thread_id"
          />
        </FormControl>
        <FormControl>
          <FormLabel>Customer ID</FormLabel>
          <FilterSelectField
            current={(router.query.customer_ids as string)?.split(",") ?? []}
            onChange={(customer_ids) => {
              addFilterToUrl("customer_ids", customer_ids.join(","));
            }}
            filter="metadata.customer_id"
          />
        </FormControl>
        <FormControl>
          <FormLabel>Label</FormLabel>
          <FilterSelectField
            current={(router.query.labels as string)?.split(",") ?? []}
            onChange={(labels) => {
              addFilterToUrl("labels", labels.join(","));
            }}
            filter="metadata.labels"
          />
        </FormControl>
      </VStack>
    </VStack>
  );
}

function FilterSelectField({
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
      onChange={(options: MultiValue<{ value: string; label: string }>) => {
        if (options) {
          onChange(options.map((o) => o.value));
        }
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
}

import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Input,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import {
  Select as MultiSelect,
  chakraComponents,
  type MultiValue,
  type SingleValue,
} from "chakra-react-select";
import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import { ChevronDown, Filter } from "react-feather";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { api } from "../utils/api";
import type { FilterField } from "../server/filters/types";
import { Form } from "react-hook-form";

export function FieldsFilters() {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { project } = useOrganizationTeamProject();
  const [selectedCustomers, setSelectedCustomers] = useState<
    { label: string; value: string }[]
  >([]);
  const [selectedLabels, setSelectedLabels] = useState<
    { label: string; value: string }[]
  >([]);
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [threadId, setThreadId] = useState("");

  const customersAndLabels = api.traces.getCustomersAndLabels.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project && isOpen,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    }
  );

  useEffect(() => {
    const query = router.query;
    if (typeof query.user_id === "string") setUserId(query.user_id);
    if (typeof query.thread_id === "string") setThreadId(query.thread_id);
  }, [router.query]);

  useEffect(() => {
    if (customersAndLabels.data) {
      if (router.query.customer_ids) {
        const customerIds = Array.isArray(router.query.customer_ids)
          ? router.query.customer_ids
          : router.query.customer_ids.split(",");
        setSelectedCustomers(
          customersAndLabels.data.customers
            .filter((customer) => customerIds.includes(customer))
            .map((customer) => ({ label: customer, value: customer }))
        );
      }
      if (router.query.labels) {
        const labels = Array.isArray(router.query.labels)
          ? router.query.labels
          : router.query.labels.split(",");
        setSelectedLabels(
          customersAndLabels.data.labels
            .filter((label) => labels.includes(label))
            .map((label) => ({ label: label, value: label }))
        );
      }
    }
  }, [customersAndLabels.data, router.query.customer_ids, router.query.labels]);

  const applyFilters = () => {
    const query = {
      ...router.query,
      user_id: userId || undefined,
      thread_id: threadId || undefined,
      customer_ids:
        selectedCustomers.map((customer) => customer.value).join(",") ||
        undefined,
      labels: selectedLabels.map((label) => label.value).join(",") || undefined,
    };
    void router.push({ query });
    onClose();
  };

  const addFilterToUrl = (field: string, value: string) => {
    void router.push({
      query: {
        ...router.query,
        [field]: value,
      },
    });
  };

  const getFilterLabel = () => {
    const parts = [];
    if (userId) parts.push(`User ID: ${userId}`);
    if (threadId) parts.push(`Thread ID: ${threadId}`);
    if (selectedCustomers.length > 0)
      parts.push(
        `Customer ID${
          selectedCustomers.length > 1 ? "s" : ""
        }: ${selectedCustomers.map((c) => c.label).join(", ")}`
      );
    if (selectedLabels.length > 0)
      parts.push(
        `Label${selectedLabels.length > 1 ? "s" : ""}: ${selectedLabels
          .map((v) => v.label)
          .join(", ")}`
      );

    const partsString = parts.length > 0 ? parts.join(", ") : "Filter";
    return (
      partsString.substring(0, 72) + (partsString.length > 72 ? "..." : "")
    );
  };

  return (
    <VStack align="start" width="full" spacing={6}>
      <Heading size="md">Filters</Heading>
      <VStack spacing={4} width="full">
        <FormControl>
          <FormLabel>User ID</FormLabel>
          <FilterSelectField
            onChange={(user_ids) => {
              addFilterToUrl("user_id", user_ids.join(","));
            }}
            filter="metadata.user_id"
          />
        </FormControl>
        <FormControl>
          <FormLabel>Thread ID</FormLabel>
          <FilterSelectField
            onChange={(thread_ids) => {
              addFilterToUrl("thread_id", thread_ids.join(","));
            }}
            filter="metadata.thread_id"
          />
        </FormControl>
        <FormControl>
          <FormLabel>Customer ID</FormLabel>
          <FilterSelectField
            onChange={(customer_ids) => {
              addFilterToUrl("customer_ids", customer_ids.join(","));
            }}
            filter="metadata.customer_id"
          />
        </FormControl>
        <FormControl>
          <FormLabel>Label</FormLabel>
          <FilterSelectField
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
}: {
  onChange: (value: string[]) => void;
  key_?: string;
  filter: FilterField;
  emptyOption?: string;
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
    }
  );

  const emptyOption_ = emptyOption ? [{ value: "", label: emptyOption }] : [];

  const options: { value: string; label: string }[] = emptyOption_.concat(
    filterData.data?.options.map(({ field, label }) => ({
      value: field,
      label,
    })) ?? []
  );

  // const current = options.find((option) => option.value === field.value);
  const current = undefined;

  // useEffect(() => {
  //   if (current === undefined && options.length > 0) {
  //     field.onChange(options[0]!.value);
  //   }
  // }, [current, emptyOption, field, options]);

  return (
    <MultiSelect
      onChange={(options: MultiValue<{ value: string; label: string }>) => {
        if (options) {
          onChange(options.map((o) => o.value));
        }
      }}
      menuPortalTarget={document.body}
      isLoading={filterData.isLoading}
      onInputChange={(input) => {
        setQuery(input);
      }}
      options={options as any}
      value={current}
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

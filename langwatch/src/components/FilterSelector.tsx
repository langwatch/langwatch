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
import { Select as MultiSelect } from "chakra-react-select";
import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import { ChevronDown, Filter } from "react-feather";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { api } from "../utils/api";

export function FilterSelector() {
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
    <Popover isOpen={isOpen} onClose={onClose} placement="bottom-end">
      <PopoverTrigger>
        <Button variant="outline" onClick={onOpen} minWidth="fit-content">
          <HStack spacing={2}>
            <Filter size={16} />
            <Text>{getFilterLabel()}</Text>
            <Box>
              <ChevronDown width={14} />
            </Box>
          </HStack>
        </Button>
      </PopoverTrigger>
      <PopoverContent width="fit-content">
        <PopoverArrow />
        <PopoverCloseButton />
        <PopoverHeader>
          <Heading size="sm">Filter Messages</Heading>
        </PopoverHeader>
        <PopoverBody padding={4}>
          <VStack spacing={4}>
            <FormControl>
              <FormLabel>User ID</FormLabel>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="Enter User ID"
              />
            </FormControl>
            <FormControl>
              <FormLabel>Thread ID</FormLabel>
              <Input
                value={threadId}
                onChange={(e) => setThreadId(e.target.value)}
                placeholder="Enter Thread ID"
              />
            </FormControl>
            {customersAndLabels.data &&
              customersAndLabels.data.customers.length > 0 && (
                <FormControl>
                  <FormLabel>Customer ID</FormLabel>
                  <MultiSelect
                    options={customersAndLabels.data.customers.map(
                      (customer) => ({
                        label: customer,
                        value: customer,
                      })
                    )}
                    value={selectedCustomers}
                    onChange={(items) => {
                      setSelectedCustomers(
                        items.map((item) => ({
                          label: item.label,
                          value: item.value,
                        }))
                      );
                    }}
                    placeholder="Select Customer IDs"
                    isMulti
                  />
                </FormControl>
              )}
            {customersAndLabels.data &&
              customersAndLabels.data.labels.length > 0 && (
                <FormControl>
                  <FormLabel>Labels</FormLabel>
                  <MultiSelect
                    options={customersAndLabels.data.labels.map((label) => ({
                      label: label,
                      value: label,
                    }))}
                    value={selectedLabels}
                    onChange={(items) => {
                      setSelectedLabels(
                        items.map((item) => ({
                          label: item.label,
                          value: item.value,
                        }))
                      );
                    }}
                    placeholder="Select Labels"
                    isMulti
                  />
                </FormControl>
              )}
            <Button colorScheme="orange" onClick={applyFilters} alignSelf="end">
              Apply
            </Button>
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}

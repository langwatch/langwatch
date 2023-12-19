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
  const [selectedVersions, setSelectedVersions] = useState<
    { label: string; value: string }[]
  >([]);
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [threadId, setThreadId] = useState("");

  const customersAndVersions = api.traces.getCustomersAndVersions.useQuery(
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
    if (customersAndVersions.data) {
      if (router.query.customer_ids) {
        const customerIds = Array.isArray(router.query.customer_ids)
          ? router.query.customer_ids
          : router.query.customer_ids.split(",");
        setSelectedCustomers(
          customersAndVersions.data.customers
            .filter((customer) => customerIds.includes(customer))
            .map((customer) => ({ label: customer, value: customer }))
        );
      }
      if (router.query.version_ids) {
        const versionIds = Array.isArray(router.query.version_ids)
          ? router.query.version_ids
          : router.query.version_ids.split(",");
        setSelectedVersions(
          customersAndVersions.data.versions
            .filter((version) => versionIds.includes(version))
            .map((version) => ({ label: version, value: version }))
        );
      }
    }
  }, [
    customersAndVersions.data,
    router.query.customer_ids,
    router.query.version_ids,
  ]);

  const applyFilters = () => {
    const query = {
      ...router.query,
      user_id: userId || undefined,
      thread_id: threadId || undefined,
      customer_ids:
        selectedCustomers.map((customer) => customer.value).join(",") ||
        undefined,
      version_ids:
        selectedVersions.map((version) => version.value).join(",") || undefined,
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
    if (selectedVersions.length > 0)
      parts.push(
        `Version${selectedVersions.length > 1 ? "s" : ""}: ${selectedVersions
          .map((v) => v.label)
          .join(", ")}`
      );
    return parts.length > 0 ? parts.join(", ") : "Filter";
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
            {customersAndVersions.data &&
              customersAndVersions.data.customers.length > 0 && (
                <FormControl>
                  <FormLabel>Customer ID</FormLabel>
                  <MultiSelect
                    options={customersAndVersions.data.customers.map(
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
            {customersAndVersions.data &&
              customersAndVersions.data.versions.length > 0 && (
                <FormControl>
                  <FormLabel>Versions</FormLabel>
                  <MultiSelect
                    options={customersAndVersions.data.versions.map(
                      (version) => ({
                        label: version,
                        value: version,
                      })
                    )}
                    value={selectedVersions}
                    onChange={(items) => {
                      setSelectedVersions(
                        items.map((item) => ({
                          label: item.label,
                          value: item.value,
                        }))
                      );
                    }}
                    placeholder="Select Versions"
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

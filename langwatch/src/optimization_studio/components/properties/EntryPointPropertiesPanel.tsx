import {
  Box,
  Button,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Tooltip } from "../../../components/ui/tooltip";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { Folder, Info } from "react-feather";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DatasetPreview } from "../../../components/datasets/DatasetPreview";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Entry } from "../../types/dsl";
import { DatasetModal } from "../DatasetModal";
import {
  BasePropertiesPanel,
  PropertySectionTitle,
} from "./BasePropertiesPanel";
import { Field } from "@chakra-ui/react";

export function EntryPointPropertiesPanel({ node }: { node: Node<Entry> }) {
  const { open, onOpen, onClose } = useDisclosure();
  const [editingDataset, setEditingDataset] = useState<
    Entry["dataset"] | undefined
  >();
  const {
    rows,
    columns,
    total: total_,
  } = useGetDatasetData({
    dataset: "dataset" in node.data ? node.data.dataset : undefined,
    preview: true,
  });
  const total = total_ ?? 0;
  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  type FormData = {
    train_size: number;
    test_size: number;
    unit: "percent" | "entries";
    seed: number;
  };

  const isPercent =
    (node.data.train_size ?? 0.8) < 1 || (node.data.test_size ?? 0.2) < 1;

  const form = useForm<FormData>({
    defaultValues: {
      train_size: (node.data.train_size ?? 0.8) * (isPercent ? 100 : 1),
      test_size: (node.data.test_size ?? 0.2) * (isPercent ? 100 : 1),
      unit: isPercent ? "percent" : "entries",
      seed: node.data.seed ?? 42,
    },
    resolver: zodResolver(
      z
        .object({
          train_size: z.number().min(0),
          test_size: z.number().min(0),
          unit: z.enum(["percent", "entries"]),
          seed: z.number().min(-1).max(100000),
        })
        .superRefine((data, ctx) => {
          const sum = data.train_size + data.test_size;

          if (data.unit === "percent" && sum > 100) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Total percentage cannot exceed 100%",
              path: ["test_size"],
            });
          }

          if (data.unit === "entries" && total && sum > total) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Total entries cannot exceed ${total} entries`,
              path: ["test_size"],
            });
          }
        })
    ),
  });

  const onSubmit = useCallback(
    ({ train_size, test_size, unit, seed }: FormData) => {
      setNode({
        id: node.id,
        data: {
          ...node.data,
          train_size: unit === "percent" ? train_size / 100 : train_size,
          test_size: unit === "percent" ? test_size / 100 : test_size,
          seed,
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const unitField = form.register("unit");
  const train_size = form.watch("train_size");
  const test_size = form.watch("test_size");
  const unit = form.watch("unit");
  const seed = form.watch("seed");

  useEffect(() => {
    void form.handleSubmit(onSubmit)();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, train_size, test_size, seed]);

  return (
    <BasePropertiesPanel
      node={node}
      outputsTitle="Fields"
      outputsReadOnly
      hideInputs
      hideParameters
    >
      <VStack
        as="form"
        width="full"
        align="start"
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <HStack width="full">
          <PropertySectionTitle>
            Dataset{" "}
            {total && (
              <Text as="span" color="gray.400">
                ({total} rows)
              </Text>
            )}
          </PropertySectionTitle>
          <Spacer />
          <Button
            size="xs"
            variant="ghost"
            marginBottom={-1}
            onClick={() => {
              setEditingDataset(undefined);
              onOpen();
            }}
          >
            <Folder size={14} />
            <Text>Choose...</Text>
          </Button>
        </HStack>
        <DatasetPreview
          rows={rows}
          columns={columns.map((column) => ({
            name: column.name,
            type: "string",
          }))}
          onClick={() => {
            setEditingDataset(node.data.dataset);
            onOpen();
          }}
          minHeight={`${36 + 29 * (rows?.length ?? 0)}px`}
        />
      </VStack>
      <DatasetModal
        open={open}
        onClose={onClose}
        node={node}
        editingDataset={editingDataset}
      />
      <HStack width="full">
        <VStack width="full" align="start">
          <HStack width="full" gap={2} paddingBottom={2}>
            <PropertySectionTitle>Optimization/Test Split</PropertySectionTitle>
            <Tooltip
              content="During optimization, a bigger part of the dataset is used for optimization and a smaller part for testing, this guarantees that the test set is not leaked into the optimization, preventing the LLM to 'cheat' it's way into a better score."
              positioning={{ placement: "top" }}
            >
              <Box paddingTop={1}>
                <Info size={14} />
              </Box>
            </Tooltip>
          </HStack>
          <HStack width="full" gap={0}>
            <HStack width="full">
              <Text
                fontSize="13px"
                fontWeight="600"
                paddingLeft={4}
                color="gray.500"
              >
                Optimization Set
              </Text>
            </HStack>
            <HStack width="full">
              <Field.Root
                width="45%"
                invalid={!!form.formState.errors.train_size}
              >
                <Input
                  {...form.register("train_size", { valueAsNumber: true })}
                  type="number"
                  required
                  min={0}
                  max={unit === "percent" ? 100 : undefined}
                  step={1}
                  size="sm"
                  paddingRight={1}
                />
              </Field.Root>
              <NativeSelect.Root width="55%" size="sm">
                <NativeSelect.Field {...unitField}>
                  <option value="percent">%</option>
                  <option value="entries">entries</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </HStack>
          </HStack>
          {form.formState.errors.train_size && (
            <Text
              color="red.700"
              fontSize="13px"
              paddingLeft={4}
              textAlign="right"
              width="full"
            >
              {form.formState.errors.train_size.message}
            </Text>
          )}
          <HStack width="full" gap={0}>
            <HStack width="full">
              <Text
                fontSize="13px"
                fontWeight="600"
                paddingLeft={4}
                color="gray.500"
              >
                Test Set
              </Text>
            </HStack>
            <HStack width="full">
              <Field.Root
                width="45%"
                invalid={!!form.formState.errors.test_size}
              >
                <Input
                  {...form.register("test_size", { valueAsNumber: true })}
                  type="number"
                  required
                  min={0}
                  max={unit === "percent" ? 100 : undefined}
                  step={1}
                  size="sm"
                  paddingRight={1}
                />
              </Field.Root>
              <NativeSelect.Root width="55%" size="sm">
                <NativeSelect.Field
                  value={unit}
                  onChange={(e) => {
                    form.setValue(
                      "unit",
                      e.target.value as "percent" | "entries"
                    );
                  }}
                >
                  <option value="percent">%</option>
                  <option value="entries">entries</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </HStack>
          </HStack>
          {form.formState.errors.test_size && (
            <Text
              color="red.700"
              fontSize="13px"
              paddingLeft={4}
              textAlign="right"
              width="full"
            >
              {form.formState.errors.test_size.message}
            </Text>
          )}
          <HStack width="full">
            <HStack width="full">
              <Text
                fontSize="13px"
                fontWeight="600"
                paddingLeft={4}
                color="gray.500"
              >
                Shuffle Seed
              </Text>
              <Tooltip content="For making sure the original dataset order does not affect performance, a seed is used to shuffle it before the split. Use -1 if you want to disable shuffling.">
                <Box paddingTop={1}>
                  <Info size={14} />
                </Box>
              </Tooltip>
            </HStack>
            <Field.Root invalid={!!form.formState.errors.seed}>
              <Input
                {...form.register("seed", { valueAsNumber: true })}
                type="number"
                size="sm"
                required
                value={node.data.seed ?? "42"}
                min={-1}
              />
            </Field.Root>
          </HStack>
          {form.formState.errors.seed && (
            <Text
              color="red.700"
              fontSize="13px"
              paddingLeft={4}
              textAlign="right"
              width="full"
            >
              {form.formState.errors.seed.message}
            </Text>
          )}
        </VStack>
      </HStack>
      <VStack width="full" align="start">
        <HStack width="full">
          <PropertySectionTitle>Manual Test Entry</PropertySectionTitle>
          <Tooltip content="When manually running the full workflow, a single entry from the dataset will be used, choose which one to pick.">
            <Box paddingTop={1}>
              <Info size={14} />
            </Box>
          </Tooltip>
        </HStack>
        <VStack width="full" align="start" gap={2}>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={
                typeof node.data.entry_selection === "number"
                  ? "specific"
                  : node.data.entry_selection
              }
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const value = e.target.value;
                setNode({
                  id: node.id,
                  data: {
                    ...node.data,
                    entry_selection: value === "specific" ? 0 : value,
                  },
                });
              }}
            >
              <option value="first">First</option>
              <option value="last">Last</option>
              <option value="random">Random</option>
              <option value="specific">Specific Row ID</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          {typeof node.data.entry_selection === "number" && (
            <Field.Root width="full">
              <Input
                type="number"
                size="sm"
                min={0}
                value={node.data.entry_selection}
                onChange={(e) => {
                  const value = e.target.value
                    ? parseInt(e.target.value, 10)
                    : 0;
                  setNode({
                    id: node.id,
                    data: {
                      ...node.data,
                      entry_selection: value,
                    },
                  });
                }}
                placeholder="Enter row ID"
              />
            </Field.Root>
          )}
        </VStack>
      </VStack>
    </BasePropertiesPanel>
  );
}

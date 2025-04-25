import { Input, Button, Text, HStack, VStack, Spinner } from "@chakra-ui/react";
import { LuSparkles, LuBot, LuChevronRight } from "react-icons/lu";
import { toaster } from "../../../../ui/toaster";
import { useChat } from "@ai-sdk/react";
import { type tools } from "../../../../../app/api/dataset/generate/tools";
import type { z } from "zod";
import { useEvaluationWizardStore } from "../../hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../../../../utils/api";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";
import { useCallback, useEffect, useMemo, useState } from "react";
import Parse from "papaparse";
import { datasetValueToGridValue } from "../../../../datasets/DatasetGrid";
import type { DatasetColumns } from "../../../../../server/datasets/types";
import { AISparklesLoader } from "../../../../icons/AISparklesLoader";
import { Markdown } from "../../../../Markdown";
import { nanoid } from "nanoid";

export function DatasetGeneration() {
  const { project } = useOrganizationTeamProject();
  const { datasetId, datasetGridRef } = useEvaluationWizardStore(
    useShallow((state) => ({
      datasetId: state.getDatasetId(),
      datasetGridRef: state.datasetGridRef,
    }))
  );

  const databaseDataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId ?? "" },
    {
      enabled: !!project && !!datasetId,
      refetchOnWindowFocus: false,
    }
  );

  const columnTypes = useMemo(() => {
    if (!databaseDataset.data) return [];
    return databaseDataset.data.columnTypes as DatasetColumns;
  }, [databaseDataset.data]);

  const datasetCsv = useMemo(() => {
    if (!databaseDataset.data) return "";

    const csvData =
      databaseDataset.data.datasetRecords.map((record) => [
        record.id,
        ...columnTypes.map((col) => {
          const value = (record.entry as any)?.[col.name];
          return datasetValueToGridValue(value, col.type);
        }),
      ]) ?? [];

    const csv = Parse.unparse({
      fields: ["id", ...columnTypes.map((col) => col.name)],
      data: csvData,
    });

    return csv;
  }, [columnTypes, databaseDataset.data]);

  const [isReady, setIsReady] = useState(false);

  const { messages, handleSubmit, input, setInput, status } = useChat({
    api: "/api/dataset/generate",
    body: {
      dataset: datasetCsv,
      projectId: project?.id,
    },
    maxSteps: 20,
    onError: (error) => {
      console.error(error);
      toaster.create({
        title: "Error",
        description: error.message,
        type: "error",
        duration: 5000,
        meta: {
          closable: true,
        },
      });
    },
    onToolCall: async (toolCall) => {
      if (!datasetGridRef?.current) return;
      const gridApi = datasetGridRef.current.api;

      const toolExecutor: {
        [T in keyof typeof tools]: (
          args: z.infer<(typeof tools)[T]["parameters"]>
        ) => Promise<any>;
      } = {
        addRow: async ({ row }) => {
          let columnNames = columnTypes.map((col) => col.name);
          if (row.length > columnNames.length) {
            columnNames = ["id", ...columnNames];
          }
          const rowData = Object.fromEntries(
            columnNames.map((col, index) => [col, row[index]])
          );
          if (!rowData.id) {
            rowData.id = `${Date.now()}-${nanoid()}`;
          }
          gridApi.applyTransaction({
            add: [rowData],
          });
          upsertRecord(rowData.id, rowData);
          return { success: true };
        },
        updateRow: async ({ id, row }) => {
          let columnNames = columnTypes.map((col) => col.name);
          if (row.length > columnNames.length) {
            columnNames = ["id", ...columnNames];
          }
          const rowData = Object.fromEntries(
            columnNames.map((col, index) => [col, row[index]])
          );
          rowData.id = id;

          gridApi.applyTransaction({
            update: [rowData],
          });
          upsertRecord(rowData.id, rowData);
          return { success: true };
        },
        // changeColumns: async ({ columns }) => {
        //   gridApi.applyColumnDefs(columns);
        //   return;
        // },
        deleteRow: async ({ id }) => {
          gridApi.applyTransaction({
            remove: [id],
          });
          deleteRecord(id);

          return { success: true };
        },
      };

      const tool =
        toolExecutor[toolCall.toolCall.toolName as keyof typeof tools];

      if (!tool) {
        toaster.create({
          title: "Error",
          description: `Unknown tool: ${toolCall.toolCall.toolName}`,
          type: "error",
          duration: 5000,
          meta: {
            closable: true,
          },
        });
        return { error: `Unknown tool: ${toolCall.toolCall.toolName}` };
      }

      let result: any;
      try {
        result = await tool(toolCall.toolCall.args as any);
      } catch (error) {
        console.error(error);
        toaster.create({
          title: "Error",
          description: "An error occurred while executing the tool",
          type: "error",
          duration: 5000,
          meta: {
            closable: true,
          },
        });
      }

      return result;
    },
  });

  if (typeof window !== "undefined") {
    (window as any).messages = messages;
  }

  const lastMessage = messages.at(-1);
  const assistantMessage =
    lastMessage && lastMessage?.role === "assistant" ? lastMessage : null;
  const lastUserMessage =
    messages.findLast((message) => message.role === "user") ?? null;
  const lastPart = assistantMessage?.parts
    ?.filter((part) => part.type !== "step-start")
    .at(-1);

  const toolNames: Record<keyof typeof tools, string> = {
    addRow: "Adding Rows",
    updateRow: "Updating Rows",
    deleteRow: "Deleting Rows",
  };

  useEffect(() => {
    if (status !== "ready") {
      setIsReady(false);
    } else {
      setTimeout(() => {
        setIsReady(true);
      }, 2000);
    }
  }, [status]);

  const updateDatasetRecord = api.datasetRecord.update.useMutation();
  const deleteDatasetRecord = api.datasetRecord.deleteMany.useMutation();

  const upsertRecord = useCallback(
    (id: string, record: any) => {
      if (!datasetId) return;

      updateDatasetRecord.mutate(
        {
          projectId: project?.id ?? "",
          datasetId: datasetId,
          recordId: id,
          updatedRecord: record,
        },
        {
          onError: () => {
            toaster.create({
              title: "Error updating record.",
              description: "Changes will be reverted, please try again",
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
            void databaseDataset.refetch();
          },
        }
      );
    },
    [databaseDataset, datasetId, project?.id, updateDatasetRecord]
  );

  const deleteRecord = useCallback(
    (id: string) => {
      if (!datasetId) return;

      deleteDatasetRecord.mutate(
        {
          projectId: project?.id ?? "",
          datasetId: datasetId,
          recordIds: [id],
        },
        {
          onSuccess: () => {
            void databaseDataset.refetch();
          },
          onError: () => {
            toaster.create({
              title: "Error deleting record.",
              description: "Please try again",
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
            void databaseDataset.refetch();
          },
        }
      );
    },
    [databaseDataset, datasetId, project?.id, deleteDatasetRecord]
  );

  return (
    <VStack
      width="full"
      align="start"
      gap={3}
      padding={4}
      borderRadius="md"
      border="1px solid"
      borderColor="gray.200"
    >
      <HStack>
        <LuSparkles size={16} />
        <Text fontWeight="medium">AI Data Generation</Text>
      </HStack>
      <Text fontSize="13px" color="gray.500">
        Describe the sample data you need for running the evaluation or ask for
        modifications to the dataset.
      </Text>
      <form onSubmit={handleSubmit} style={{ width: "100%" }}>
        <VStack gap={2} width="full" align="start">
          <Input
            placeholder="e.g. Add 10 customer support examples"
            border="1px solid"
            borderColor="gray.200"
            borderRadius="md"
            padding={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            width="full"
          />
          <Button
            colorPalette="blue"
            type="submit"
            disabled={status === "submitted" || status === "streaming"}
          >
            {status === "submitted" || status === "streaming" ? (
              <AISparklesLoader color="white" />
            ) : (
              <LuBot size={16} />
            )}
            Generate
          </Button>
        </VStack>
      </form>
      <VStack gap={2} width="full" align="start" paddingTop={2}>
        {lastUserMessage && (
          <HStack gap={1} _icon={{ marginTop: "1px", marginLeft: "-4px" }}>
            <LuChevronRight size={16} />
            <Text fontSize="14px" color="gray.500">
              {lastUserMessage.content}
            </Text>
          </HStack>
        )}
        <Text fontSize="13px" color="gray.500">
          <Markdown className="">{assistantMessage?.content ?? ""}</Markdown>
        </Text>
        {!isReady && lastPart?.type === "tool-invocation" && (
          <HStack>
            <Spinner size="sm" />{" "}
            <Text fontSize="13px" color="gray.500">
              {
                toolNames[
                  lastPart.toolInvocation.toolName as keyof typeof tools
                ]
              }
            </Text>
          </HStack>
        )}
      </VStack>
    </VStack>
  );
}

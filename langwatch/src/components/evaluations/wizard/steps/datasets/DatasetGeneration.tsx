import { Input, Button, Text, HStack, VStack, Spinner } from "@chakra-ui/react";
import { LuSparkles, LuBot, LuChevronRight } from "react-icons/lu";
import { toaster } from "../../../../ui/toaster";
import { useChat } from "@ai-sdk/react";
import { useEvaluationWizardStore } from "../../hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../../../../utils/api";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Parse from "papaparse";
import { datasetValueToGridValue } from "../../../../datasets/DatasetGrid";
import type { DatasetColumns } from "../../../../../server/datasets/types";
import { AISparklesLoader } from "../../../../icons/AISparklesLoader";
import { Markdown } from "../../../../Markdown";
import { nanoid } from "nanoid";
import { DefaultChatTransport } from "ai";
import { captureException } from "@sentry/node";

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
  const [input, setInput] = useState("");

  const { messages, sendMessage, addToolResult, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/dataset/generate",
    }),
    onError: (error) => {
      console.error("Error in useChat", error);
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
    onToolCall: async ({ toolCall }) => {
      if (!datasetGridRef?.current) return;
      const gridApi = datasetGridRef.current.api;

      // Ensure database data is loaded
      if (!databaseDataset.data) {
        console.warn("Database data not loaded yet, fallback will be used...");
      }

      const toolExecutor: {
        addRow: (args: { row: Record<string, string> }) => Promise<any>;
        updateRow: (args: {
          id: string;
          row: Record<string, string>;
        }) => Promise<any>;
        deleteRow: (args: { id: string }) => Promise<any>;
      } = {
        addRow: async (args) => {
          const { row } = args;

          // Get column types directly from database data to ensure we have the latest
          const currentColumnTypes =
            (databaseDataset.data?.columnTypes as DatasetColumns) || [];

          // If database data is not available, try to get column names from grid API
          let columnNames = ["id"];
          if (currentColumnTypes.length > 0) {
            columnNames = ["id", ...currentColumnTypes.map((col) => col.name)];
          } else {
            // Fallback: try to get column names from the grid
            try {
              const gridColumns = gridApi.getColumnDefs();
              if (gridColumns && gridColumns.length > 1) {
                // Filter out internal columns and get only data columns
                const dataColumns = gridColumns
                  .filter((col: any) => {
                    // Skip internal columns like 'selected', row index columns, etc.
                    return (
                      col.field &&
                      col.field !== "selected" &&
                      !col.field.match(/^\d+$/) && // Skip numeric-only field names
                      col.colId !== "selected" &&
                      col.colId !== "0"
                    );
                  })
                  .map((col: any) => col.field || col.colId);

                columnNames = ["id", ...dataColumns];
              }
            } catch (error) {
              toaster.create({
                title: "Error",
                description: "Failed to get grid columns via fallback",
                type: "error",
                duration: 5000,
                meta: { closable: true },
              });
              return;
            }
          }

          // If we still don't have column names, create generic ones based on row length
          if (columnNames.length === 1 && Object.keys(row).length > 1) {
            toaster.create({
              title: "Error",
              description: "Failed to get grid columns",
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
            return;
          }

          const rowData = Object.fromEntries(
            columnNames.map((col) => [col, row[col] ?? ""])
          );
          if (!rowData.id) {
            rowData.id = nanoid();
          }

          gridApi.applyTransaction({
            add: [rowData],
          });
          upsertRecord(rowData.id, rowData);

          return { success: true };
        },
        updateRow: async (args) => {
          const { id, row } = args;
          // Get column types directly from database data to ensure we have the latest
          const currentColumnTypes =
            (databaseDataset.data?.columnTypes as DatasetColumns) || [];

          // If database data is not available, try to get column names from grid API
          let columnNames = ["id"];
          if (currentColumnTypes.length > 0) {
            columnNames = ["id", ...currentColumnTypes.map((col) => col.name)];
          } else {
            // Fallback: try to get column names from the grid
            try {
              const gridColumns = gridApi.getColumnDefs();
              if (gridColumns && gridColumns.length > 1) {
                // Filter out internal columns and get only data columns
                const dataColumns = gridColumns
                  .filter((col: any) => {
                    // Skip internal columns like 'selected', row index columns, etc.
                    return (
                      col.field &&
                      col.field !== "selected" &&
                      !col.field.match(/^\d+$/) && // Skip numeric-only field names
                      col.colId !== "selected" &&
                      col.colId !== "0"
                    );
                  })
                  .map((col: any) => col.field || col.colId);

                columnNames = ["id", ...dataColumns];
              }
            } catch (error) {
              toaster.create({
                title: "Error",
                description: "Failed to get grid columns via fallback",
                type: "error",
                duration: 5000,
                meta: { closable: true },
              });

              return;
            }
          }

          const rowData = Object.fromEntries(
            columnNames.map((col) => [col, row[col] ?? ""])
          );
          rowData.id = id;

          gridApi.applyTransaction({
            update: [rowData],
          });
          upsertRecord(rowData.id, rowData);
          return { success: true };
        },
        deleteRow: async (args) => {
          const { id } = args;
          gridApi.applyTransaction({
            remove: [id],
          });
          deleteRecord(id);

          return { success: true };
        },
      };

      const tool =
        toolExecutor[toolCall.toolName as "addRow" | "updateRow" | "deleteRow"];

      if (!tool) {
        toaster.create({
          title: "Error",
          description: `Unknown tool: ${toolCall.toolName}`,
          type: "error",
          duration: 5000,
          meta: {
            closable: true,
          },
        });
        throw new Error(`Unknown tool: ${toolCall.toolName}`);
      }

      try {
        const result = await tool(toolCall.input as any);
        void addToolResult({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output: result,
        });
      } catch (error) {
        console.error("Error executing tool", error);
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
    },
  });

  const lastMessage = messages.at(-1);
  const assistantMessage =
    lastMessage && lastMessage?.role === "assistant" ? lastMessage : null;
  const lastUserMessage =
    messages.findLast((message) => message.role === "user") ?? null;
  const lastPart = assistantMessage?.parts
    ?.filter((part) => part.type !== "step-start")
    .at(-1);

  const toolNames = {
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

  // Queue-based update system
  const updateQueue = useRef<Array<{ id: string; record: any }>>([]);
  const isProcessing = useRef(false);

  const processQueue = useCallback(async () => {
    if (isProcessing.current || updateQueue.current.length === 0 || !datasetId)
      return;

    isProcessing.current = true;

    while (updateQueue.current.length > 0) {
      const update = updateQueue.current.shift();
      if (!update) continue;

      try {
        await new Promise<void>((resolve, reject) => {
          updateDatasetRecord.mutate(
            {
              projectId: project?.id ?? "",
              datasetId: datasetId,
              recordId: update.id,
              updatedRecord: update.record,
            },
            {
              onSuccess: () => {
                void databaseDataset.refetch();
                resolve();
              },
              onError: (error) => {
                // Don't show error toast for unique constraint violations as they're expected
                if (error?.message?.includes("Unique constraint failed")) {
                  console.warn("Record already exists, skipping:", update.id);
                  resolve();
                  return;
                }

                toaster.create({
                  title: "Error updating record.",
                  description: "Changes will be reverted, please try again",
                  type: "error",
                  duration: 5000,
                  meta: { closable: true },
                });
                void databaseDataset.refetch();
                reject(error);
              },
            }
          );
        });

        // Small delay to prevent race conditions
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        console.error("Error processing update queue:", error);
        break;
      }
    }

    isProcessing.current = false;
  }, [datasetId, project?.id, updateDatasetRecord, databaseDataset]);

  const upsertRecord = useCallback(
    (id: string, record: any) => {
      if (!datasetId) return;

      // Add to queue
      updateQueue.current.push({ id, record });

      // Start processing if not already processing
      if (!isProcessing.current) {
        processQueue().catch((error) => {
          captureException(error, {
            tags: {
              datasetId: datasetId,
            },
          });
          console.error("Error processing queue during upsert:", error);
        });
      }
    },
    [datasetId, processQueue]
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

  // Cleanup effect to process remaining queue items
  useEffect(() => {
    const queue = updateQueue.current;
    const processing = isProcessing.current;

    return () => {
      if (queue?.length > 0 && !processing) {
        processQueue().catch((error) => {
          captureException(error, {
            tags: {
              datasetId: datasetId,
            },
          });
          console.error("Error processing queue during cleanup:", error);
        });
      }
    };
  }, [processQueue, datasetId]);

  // Process queue when dataset changes
  useEffect(() => {
    if (updateQueue.current?.length > 0 && !isProcessing.current) {
      processQueue().catch((error) => {
        console.error("Error processing queue during dataset change:", error);
        captureException(error, {
          tags: {
            datasetId: datasetId,
          },
        });
        console.error("Error processing queue during cleanup:", error);
      });
    }
  }, [datasetId, processQueue]);

  async function generate() {
    if (status !== "ready") return;

    if (input.trim()) {
      await sendMessage(
        { role: "user", parts: [{ type: "text", text: input }] },
        {
          body: {
            dataset: datasetCsv,
            projectId: project?.id,
          },
        }
      );
      setInput("");
    }
  }

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
      <VStack gap={2} width="full" align="start">
        <Input
          placeholder="e.g. Add 10 customer support examples"
          border="1px solid"
          borderColor="gray.200"
          borderRadius="md"
          padding={2}
          value={input}
          disabled={status !== "ready"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void generate();
            }
          }}
          width="full"
        />
        <Button
          colorPalette="blue"
          onClick={() => void generate()}
          disabled={status !== "ready"}
        >
          {status === "submitted" || status === "streaming" ? (
            <AISparklesLoader color="white" />
          ) : (
            <LuBot size={16} />
          )}
          Generate
        </Button>
      </VStack>
      <VStack gap={2} width="full" align="start" paddingTop={2}>
        {lastUserMessage && (
          <HStack gap={1} _icon={{ marginTop: "1px", marginLeft: "-4px" }}>
            <LuChevronRight size={16} />
            <Text fontSize="14px" color="gray.500">
              {lastUserMessage.parts[0]?.type === "text"
                ? lastUserMessage.parts[0].text
                : ""}
            </Text>
          </HStack>
        )}
        <Text fontSize="13px" color="gray.500">
          <Markdown className="">
            {assistantMessage?.parts[0]?.type === "text"
              ? assistantMessage.parts[0].text
              : ""}
          </Markdown>
        </Text>
        {!isReady && lastPart?.type?.startsWith("tool-") && (
          <HStack>
            <Spinner size="sm" />{" "}
            <Text fontSize="13px" color="gray.500">
              {
                toolNames[
                  (lastPart as any).toolName as
                    | "addRow"
                    | "updateRow"
                    | "deleteRow"
                ]
              }
            </Text>
          </HStack>
        )}
      </VStack>
    </VStack>
  );
}

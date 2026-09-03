import type {
  DatasetEntrySelection,
  DatasetService,
  DatasetWithRecords,
} from "@langwatch/dataset-contract";
import {
  applyEntryInputDefaults,
  parseStudioWorkflow,
  studioClientEventSchema,
  type NodeDataset,
  type StudioClientEvent,
} from "@langwatch/workflow-contract";

type DatasetRows = Record<string, unknown>[];

export class StudioDatasetMaterializerService {
  static create(datasets: DatasetService): StudioDatasetMaterializerService {
    return new StudioDatasetMaterializerService(datasets);
  }

  private constructor(private readonly datasets: DatasetService) {}

  async materialize(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent> {
    const event = input.event;
    if (!("workflow" in event.payload)) {
      return event;
    }

    const nodes = await Promise.all(
      event.payload.workflow.nodes.map(async (node) => {
        if (!("dataset" in node.data) || !node.data.dataset) {
          return node;
        }

        if (event.type === "execute_component") {
          return {
            ...node,
            data: { ...node.data, dataset: void 0 },
          };
        }

        const entrySelection = event.type === "execute_flow" ? node.data.entry_selection : "all";
        const sourceDataset = node.data.dataset;
        if (sourceDataset.inline) {
          if (entrySelection === "all") {
            return node;
          }

          const records = this.rowsFromColumns(sourceDataset.inline.records);
          const selectedRecords = this.selectInlineRecords(records, entrySelection);

          return {
            ...node,
            data: {
              ...node.data,
              dataset: {
                ...sourceDataset,
                inline: {
                  ...sourceDataset.inline,
                  records: this.columnsFromRows(selectedRecords),
                },
              },
            },
          };
        }

        if (!sourceDataset.id) {
          throw new Error("Dataset ID is required");
        }

        const loadedDataset = await this.datasets.getDatasetWithRecords({
          slugOrId: sourceDataset.id,
          projectId: input.projectId,
          entrySelection,
          limitMb: null,
        });

        return {
          ...node,
          data: {
            ...node.data,
            dataset: this.inlineDatasetFromRecords(loadedDataset),
          },
        };
      }),
    );

    const workflow = applyEntryInputDefaults(
      parseStudioWorkflow({
        ...event.payload.workflow,
        nodes,
      }),
    );

    return studioClientEventSchema.parse({
      ...event,
      payload: { ...event.payload, workflow },
    });
  }

  private rowsFromColumns(columns: Record<string, unknown[]>): DatasetRows {
    const rowCount = Math.max(0, ...Object.values(columns).map((values) => values.length));

    return Array.from({ length: rowCount }, (_, index) =>
      Object.fromEntries(
        Object.entries(columns).flatMap(([column, values]) =>
          index < values.length ? [[column, values[index]]] : [],
        ),
      ),
    );
  }

  private columnsFromRows(rows: DatasetRows): Record<string, unknown[]> {
    return rows.reduce<Record<string, unknown[]>>((columns, row) => {
      for (const [key, value] of Object.entries(row)) {
        if (key === "id" || key === "selected") {
          continue;
        }

        (columns[key] ??= []).push(value);
      }

      return columns;
    }, {});
  }

  private inlineDatasetFromRecords(input: DatasetWithRecords): NodeDataset {
    return {
      name: input.dataset.name,
      inline: {
        records: this.columnsFromRows(
          input.records.map((record) =>
            Object.fromEntries(
              input.dataset.columnTypes.map((column) => {
                const value = record.entry[column.name];
                return [column.name, typeof value === "object" ? JSON.stringify(value) : value];
              }),
            ),
          ),
        ),
        columnTypes: input.dataset.columnTypes,
      },
    };
  }

  private selectInlineRecords(
    records: DatasetRows,
    selection: Exclude<DatasetEntrySelection, "all">,
  ): DatasetRows {
    let selected: Record<string, unknown> | undefined;
    if (typeof selection === "number") {
      selected = records[selection] ?? records[0];
    } else if (selection === "random") {
      selected = records[Math.floor(Math.random() * records.length)];
    } else if (selection === "last") {
      selected = records.at(-1);
    } else {
      selected = records[0];
    }

    return selected === void 0 ? [] : [selected];
  }
}

import { type ClickHouseClient } from "@clickhouse/client";
import type {
  CheckpointRepository,
  CheckpointRecord,
} from "./checkpointRepository.types";
import { createLogger } from "../../../../../utils/logger";

/**
 * ClickHouse implementation of CheckpointRepository.
 * Handles raw data access to ClickHouse without business logic.
 */
export class CheckpointRepositoryClickHouse implements CheckpointRepository {
  private readonly logger = createLogger(
    "langwatch:event-sourcing:checkpoint-repository:clickhouse",
  );

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async getCheckpointRecord(
    checkpointKey: string,
  ): Promise<CheckpointRecord | null> {
    try {
      // Use FINAL to get the latest version from ReplacingMergeTree
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            CheckpointKey,
            ProcessorName,
            ProcessorType,
            EventId,
            Status,
            EventTimestamp,
            SequenceNumber,
            ProcessedAt,
            FailedAt,
            ErrorMessage,
            TenantId,
            AggregateType,
            AggregateId
          FROM processor_checkpoints FINAL
          WHERE CheckpointKey = {checkpointKey:String}
          LIMIT 1
        `,
        query_params: {
          checkpointKey,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<CheckpointRecord>();
      const row = rows[0];

      if (!row) {
        return null;
      }

      return row;
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
        },
        "Failed to get checkpoint record from ClickHouse",
      );
      throw error;
    }
  }

  async getLastProcessedCheckpointRecord(
    checkpointKey: string,
  ): Promise<CheckpointRecord | null> {
    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            CheckpointKey,
            ProcessorName,
            ProcessorType,
            EventId,
            Status,
            EventTimestamp,
            SequenceNumber,
            ProcessedAt,
            FailedAt,
            ErrorMessage,
            TenantId,
            AggregateType,
            AggregateId
          FROM processor_checkpoints FINAL
          WHERE CheckpointKey = {checkpointKey:String}
            AND Status = 'processed'
          LIMIT 1
        `,
        query_params: {
          checkpointKey,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<CheckpointRecord>();
      const row = rows[0];

      if (!row) {
        return null;
      }

      return row;
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
        },
        "Failed to get last processed checkpoint record from ClickHouse",
      );
      throw error;
    }
  }

  async getCheckpointRecordBySequenceNumber(
    checkpointKey: string,
    sequenceNumber: number,
  ): Promise<CheckpointRecord | null> {
    try {
      // Query for checkpoints with sequence >= requested
      // Accept "processed" status (normal case) or "pending" status for exact sequence match
      // With distributed locking, if we have the lock and previous event is "pending",
      // it means the previous event finished but checkpoint save hasn't completed yet
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            CheckpointKey,
            ProcessorName,
            ProcessorType,
            EventId,
            Status,
            EventTimestamp,
            SequenceNumber,
            ProcessedAt,
            FailedAt,
            ErrorMessage,
            TenantId,
            AggregateType,
            AggregateId
          FROM processor_checkpoints FINAL
          WHERE CheckpointKey = {checkpointKey:String}
            AND SequenceNumber >= {sequenceNumber:UInt64}
            AND Status != 'failed'
            AND (
              Status = 'processed'
              OR (Status = 'pending' AND SequenceNumber = {sequenceNumber:UInt64})
            )
          ORDER BY SequenceNumber ASC
          LIMIT 1
        `,
        query_params: {
          checkpointKey,
          sequenceNumber,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<CheckpointRecord>();
      const row = rows[0];

      if (!row) {
        return null;
      }

      return row;
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          sequenceNumber,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
        },
        "Failed to get checkpoint record by sequence number from ClickHouse",
      );
      throw error;
    }
  }

  async hasFailedCheckpointRecords(
    checkpointKey: string,
  ): Promise<boolean> {
    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT COUNT(*) as count
          FROM processor_checkpoints FINAL
          WHERE CheckpointKey = {checkpointKey:String}
            AND Status = 'failed'
          LIMIT 1
        `,
        query_params: {
          checkpointKey,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<{ count: number }>();
      const count = rows[0]?.count ?? 0;

      return count > 0;
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
        },
        "Failed to check for failed checkpoint records in ClickHouse",
      );
      throw error;
    }
  }

  async getFailedCheckpointRecords(
    checkpointKey: string,
  ): Promise<CheckpointRecord[]> {
    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            CheckpointKey,
            ProcessorName,
            ProcessorType,
            EventId,
            Status,
            EventTimestamp,
            SequenceNumber,
            ProcessedAt,
            FailedAt,
            ErrorMessage,
            TenantId,
            AggregateType,
            AggregateId
          FROM processor_checkpoints FINAL
          WHERE CheckpointKey = {checkpointKey:String}
            AND Status = 'failed'
          ORDER BY EventTimestamp ASC
        `,
        query_params: {
          checkpointKey,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<CheckpointRecord>();

      return rows;
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
        },
        "Failed to get failed checkpoint records from ClickHouse",
      );
      throw error;
    }
  }

  async insertCheckpointRecord(record: CheckpointRecord): Promise<void> {
    try {
      await this.clickHouseClient.insert({
        table: "processor_checkpoints",
        values: [record],
        format: "JSONEachRow",
      });

      this.logger.debug(
        {
          processorName: record.ProcessorName,
          processorType: record.ProcessorType,
          eventId: record.EventId,
          status: record.Status,
          tenantId: record.TenantId,
          aggregateType: record.AggregateType,
          aggregateId: record.AggregateId,
        },
        "Inserted checkpoint record to ClickHouse",
      );
    } catch (error) {
      this.logger.error(
        {
          processorName: record.ProcessorName,
          processorType: record.ProcessorType,
          eventId: record.EventId,
          status: record.Status,
          tenantId: record.TenantId,
          aggregateType: record.AggregateType,
          aggregateId: record.AggregateId,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
        },
        "Failed to insert checkpoint record to ClickHouse",
      );
      throw error;
    }
  }

  async deleteCheckpointRecord(
    checkpointKey: string,
  ): Promise<void> {
    try {
      // Delete checkpoint using ALTER DELETE
      await this.clickHouseClient.command({
        query: `
          ALTER TABLE processor_checkpoints
          DELETE WHERE CheckpointKey = {checkpointKey:String}
        `,
        query_params: {
          checkpointKey,
        },
      });

      this.logger.debug(
        {
          checkpointKey,
        },
        "Deleted checkpoint record from ClickHouse",
      );
    } catch (error) {
      this.logger.error(
        {
          checkpointKey,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
        },
        "Failed to delete checkpoint record from ClickHouse",
      );
      throw error;
    }
  }
}


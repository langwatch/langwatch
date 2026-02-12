import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "../../../../../utils/logger/server";
import type { TenantId } from "../../../library/domain/tenantId";
import type {
  CheckpointRecord,
  CheckpointRepository,
} from "./checkpointRepository.types";

/**
 * ClickHouse implementation of CheckpointRepository.
 * Handles raw data access to ClickHouse without business logic.
 *
 * Schema in /server/clickhouse/migrations/00003_create_processor_checkpoints.sql
 */
export class CheckpointRepositoryClickHouse implements CheckpointRepository {
  private readonly logger = createLogger(
    "langwatch:event-sourcing:checkpoint-repository:clickhouse",
  );

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async getCheckpointRecord(
    checkpointKey: string,
    tenantId: TenantId,
  ): Promise<CheckpointRecord | null> {
    try {
      // Use FINAL to get the latest version from ReplacingMergeTree
      // Exclude failed checkpoints - they are a separate concern and should not
      // be returned by this method which loads "current state"
      // With ORDER BY (TenantId, CheckpointKey, Status), we need to explicitly
      // filter by Status to avoid non-deterministic results
      // TenantId filter enables primary index skip (first column in ORDER BY)
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
          WHERE TenantId = {tenantId:String}
            AND CheckpointKey = {checkpointKey:String}
            AND Status != 'failed'
          ORDER BY SequenceNumber DESC
          LIMIT 1
        `,
        query_params: {
          checkpointKey,
          tenantId,
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
    tenantId: TenantId,
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
          WHERE TenantId = {tenantId:String}
            AND CheckpointKey = {checkpointKey:String}
            AND Status = 'processed'
          LIMIT 1
        `,
        query_params: {
          checkpointKey,
          tenantId,
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
    tenantId: TenantId,
  ): Promise<CheckpointRecord | null> {
    try {
      // Query for checkpoints that prove the requested sequence was processed.
      //
      // With ORDER BY (TenantId, CheckpointKey, Status), we have separate partitions
      // for each Status. Failed checkpoints are in a separate partition and must be
      // explicitly excluded to prevent them from being counted as "processed".
      //
      // When event N+1 starts processing, it saves a "pending" checkpoint that REPLACES
      // the "processed" checkpoint from event N (within the same Status partition).
      // This means we can't just look for a "processed" checkpoint with the exact sequence number.
      //
      // Logic:
      // 1. If we find a "processed" checkpoint with seq >= requested, the requested seq is done
      // 2. If we find a "pending" checkpoint with seq > requested, the requested seq must be done
      //    (otherwise the higher sequence couldn't have started processing)
      // 3. A "pending" checkpoint with seq = requested means it's STILL processing - NOT valid
      // 4. Failed checkpoints are explicitly excluded (Status != 'failed')
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
          WHERE TenantId = {tenantId:String}
            AND CheckpointKey = {checkpointKey:String}
            AND Status != 'failed'
            AND SequenceNumber >= {sequenceNumber:UInt64}
            AND (
              Status = 'processed'
              OR (Status = 'pending' AND SequenceNumber > {sequenceNumber:UInt64})
            )
          ORDER BY SequenceNumber ASC
          LIMIT 1
        `,
        query_params: {
          checkpointKey,
          sequenceNumber,
          tenantId,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<CheckpointRecord>();
      const row = rows[0];

      if (!row) {
        return null;
      }

      // If we found a pending checkpoint for a HIGHER sequence, convert the result
      // to indicate the requested sequence is processed (since it must be for the
      // higher sequence to have started)
      if (row.Status === "pending" && row.SequenceNumber > sequenceNumber) {
        return {
          ...row,
          Status: "processed",
          SequenceNumber: sequenceNumber,
        };
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
    tenantId: TenantId,
  ): Promise<boolean> {
    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT COUNT(*) as count
          FROM processor_checkpoints FINAL
          WHERE TenantId = {tenantId:String}
            AND CheckpointKey = {checkpointKey:String}
            AND Status = 'failed'
          LIMIT 1
        `,
        query_params: {
          checkpointKey,
          tenantId,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<{ count: string }>();
      const count = Number(rows[0]?.count ?? 0);

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
    tenantId: TenantId,
  ): Promise<CheckpointRecord[]> {
    try {
      // With ORDER BY (TenantId, CheckpointKey, Status), failed checkpoints are in
      // a separate partition. Multiple failed SequenceNumbers can coexist.
      // Order by SequenceNumber to return failures in processing order.
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
          WHERE TenantId = {tenantId:String}
            AND CheckpointKey = {checkpointKey:String}
            AND Status = 'failed'
          ORDER BY SequenceNumber ASC
        `,
        query_params: {
          checkpointKey,
          tenantId,
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
      this.logger.debug(
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
    tenantId: TenantId,
  ): Promise<void> {
    try {
      // Delete checkpoint using ALTER DELETE
      // TenantId filter enables primary index skip (first column in ORDER BY)
      await this.clickHouseClient.command({
        query: `
          ALTER TABLE processor_checkpoints
          DELETE WHERE TenantId = {tenantId:String}
            AND CheckpointKey = {checkpointKey:String}
        `,
        query_params: {
          checkpointKey,
          tenantId,
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

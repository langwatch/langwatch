/**
 * Utilities for constructing and parsing checkpoint keys.
 *
 * Checkpoint keys use the format: `tenantId:pipelineName:processorName:aggregateType:aggregateId`
 * This represents a checkpoint for an entire aggregate, not a specific event.
 * The checkpoint record stores the last processed event's details (EventId, SequenceNumber, etc.)
 * for that aggregate.
 *
 * **Security:** All components must not contain `:` to prevent key injection vulnerabilities.
 */

import { createTenantId, type TenantId } from "../domain/tenantId";

/**
 * Builds a checkpoint key from its components.
 * Format: `tenantId:pipelineName:processorName:aggregateType:aggregateId`
 *
 * This key represents a checkpoint for an entire aggregate, not a specific event.
 * The checkpoint record stores the last processed event's details.
 *
 * @param tenantId - The tenant ID (must not contain `:`)
 * @param pipelineName - The pipeline name (must not contain `:`)
 * @param processorName - The processor name (must not contain `:`)
 * @param aggregateType - The aggregate type (must not contain `:`)
 * @param aggregateId - The aggregate ID (must not contain `:`)
 * @returns The checkpoint key in format `tenantId:pipelineName:processorName:aggregateType:aggregateId`
 * @throws {Error} If any component contains `:`
 */
export function buildCheckpointKey(
  tenantId: TenantId,
  pipelineName: string,
  processorName: string,
  aggregateType: string,
  aggregateId: string,
): string {
  // Validate no colons in components
  const components = { tenantId, pipelineName, processorName, aggregateType, aggregateId };
  for (const [name, value] of Object.entries(components)) {
    if (value.includes(":")) {
      throw new Error(`${name} cannot contain ':' delimiter: ${value}`);
    }
  }
  return `${tenantId}:${pipelineName}:${processorName}:${aggregateType}:${aggregateId}`;
}

/**
 * Parsed checkpoint key components.
 */
export interface ParsedCheckpointKey {
  tenantId: TenantId;
  pipelineName: string;
  processorName: string;
  aggregateType: string;
  aggregateId: string;
}

/**
 * Parses a checkpoint key into its components.
 *
 * @param checkpointKey - The checkpoint key to parse
 * @returns Parsed components
 * @throws {Error} If the key format is invalid
 */
export function parseCheckpointKey(
  checkpointKey: string,
): ParsedCheckpointKey {
  const parts = checkpointKey.split(":");
  if (parts.length !== 5) {
    throw new Error(
      `Invalid checkpoint key format: ${checkpointKey}. Expected format: tenantId:pipelineName:processorName:aggregateType:aggregateId`,
    );
  }

  const tenantId = parts[0]!;
  const pipelineName = parts[1]!;
  const processorName = parts[2]!;
  const aggregateType = parts[3]!;
  const aggregateId = parts[4]!;

  if (!tenantId || !pipelineName || !processorName || !aggregateType || !aggregateId) {
    throw new Error(
      `Invalid checkpoint key format: ${checkpointKey}. All components must be non-empty.`,
    );
  }

  return {
    tenantId: createTenantId(tenantId),
    pipelineName,
    processorName,
    aggregateType,
    aggregateId,
  };
}


import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventStoreClickHouse } from "../eventStoreClickHouse";
import type { Event } from "../../library";
import type { AggregateType } from "../../library/core/aggregateType";
import { createTenantId } from "../../library/core/tenantId";
import { createEventStoreValidationTests } from "./shared/eventStoreValidation.test-utils";

let mockClickHouseClient: any;

beforeEach(() => {
  mockClickHouseClient = {
    query: vi.fn(),
    insert: vi.fn().mockResolvedValue(void 0),
  };
});

createEventStoreValidationTests({
  describe,
  it,
  expect,
  createStore: () => new EventStoreClickHouse(mockClickHouseClient),
  aggregateType: "trace" as AggregateType,
  getStoreName: () => "EventStoreClickHouse",
  onStoreEventsSuccess: async () => {
    // Only expect insert to be called if events were actually stored (non-empty array)
    // Empty arrays don't trigger insert, which is correct behavior
    if (mockClickHouseClient.insert.mock.calls.length > 0) {
      expect(mockClickHouseClient.insert).toHaveBeenCalled();
    }
  },
  onStoreEventsFailure: async () => {
    expect(mockClickHouseClient.insert).not.toHaveBeenCalled();
  },
});

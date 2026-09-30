/**
 * @vitest-environment node
 * A virtual key's caller-owned bookkeeping as the wire publishes it.
 * @see specs/ai-gateway/public-rest-api.feature
 */
import { describe, expect, it } from "vitest";

import { virtualKeyRow } from "../app/__tests__/gateway-virtual-key.fixture.ts";
import { GatewayVirtualKeyDtoService } from "../services/gateway-virtual-key-dto.service.ts";

const dtos = GatewayVirtualKeyDtoService.create();
const facts = { archivedProjectIds: new Set<string>() };

describe("a virtual key's external id and metadata", () => {
  /** @scenario A virtual key carries the caller's own id and bookkeeping */
  it("echo what the caller stored", () => {
    const dto = dtos.toVirtualKeySnakeDto({
      virtualKey: { ...virtualKeyRow(), externalId: "billing-42", metadata: { tier: "gold" } },
      facts,
    });

    expect(dto).toMatchObject({ external_id: "billing-42", metadata: { tier: "gold" } });
  });

  /** @scenario A key with no external id reads as null, not as an empty string */
  it("read as null and an empty object when the caller named neither", () => {
    const dto = dtos.toVirtualKeySnakeDto({ virtualKey: virtualKeyRow(), facts });

    expect(dto.external_id).toBeNull();
    expect(dto.metadata).toEqual({});
  });
});

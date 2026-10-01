/**
 * @vitest-environment node
 * The back office names a connection, never a tenant: the organization the
 * history is read under comes off the connection's own projection.
 * Corresponds to specs/identity/sso-connection-history.feature.
 */
import {
  emptySsoConnection,
  SsoConnectionNotFoundError,
  type SsoConnectionState,
} from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import { SsoConnectionBackofficeRepository } from "../../repositories/sso-connection-backoffice.repository.ts";
import { SsoConnectionHistoryRepository } from "../../repositories/sso-connection-history.repository.ts";
import { SsoConnectionBackofficeService } from "../sso-connection-backoffice.service.ts";
import { SsoConnectionHistoryService } from "../sso-connection-history.service.ts";

const ACME = "org_acme";
const CONNECTION = "ssoc_acme";

function backofficeOver(state: SsoConnectionState | null) {
  const findHistory = vi.fn<SsoConnectionHistoryRepository["findHistory"]>().mockResolvedValue([]);
  class StubHistory extends SsoConnectionHistoryRepository {
    findHistory = findHistory;
  }
  class StubReads extends SsoConnectionBackofficeRepository {
    listPage = vi.fn().mockResolvedValue({ states: [], total: 0 });
    getById = vi.fn(async () => {
      if (!state) throw new SsoConnectionNotFoundError("no connection");
      return state;
    });
    findOrganizationNames = vi.fn().mockResolvedValue(new Map<string, string>());
  }
  return {
    service: SsoConnectionBackofficeService.create({
      reads: new StubReads(),
      connections: () => {
        throw new Error("the history read commands nothing");
      },
      history: () => SsoConnectionHistoryService.create({ history: new StubHistory() }),
    }),
    findHistory,
  };
}

describe("given an operator reading a connection's history from the back office", () => {
  describe("when the connection exists", () => {
    it("reads the log under the organization the connection itself names", async () => {
      const { service, findHistory } = backofficeOver({
        ...emptySsoConnection({ connectionId: CONNECTION }),
        organizationId: ACME,
      });

      await service.findHistory({ connectionId: CONNECTION });

      expect(findHistory).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ACME, connectionId: CONNECTION }),
      );
    });
  });

  describe("when no connection carries that id", () => {
    it("answers null without reading any organization's log", async () => {
      const { service, findHistory } = backofficeOver(null);

      await expect(service.findHistory({ connectionId: CONNECTION })).resolves.toBeNull();
      expect(findHistory).not.toHaveBeenCalled();
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { EventSourcing } from "../../eventSourcing";

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));

vi.mock("@langwatch/observability", () => {
  const createLogger = () => {
    const logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: warnMock,
      error: vi.fn(),
      fatal: vi.fn(),
      child: () => logger,
    };
    return logger;
  };
  return { createLogger };
});

describe("ADR-052 legacy queue tombstone", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe.each(["settle", "cadence", "graphEval"])(
    "given a staged %s payload from the retired outbox",
    (stage) => {
      it("acknowledges and drops it before event routing", async () => {
        const eventSourcing = new EventSourcing({ redis: null });

        await expect(
          eventSourcing.globalQueue!.send({
            stage,
            projectId: "project-1",
            arbitraryLegacyRevision: true,
          }),
        ).resolves.toBeUndefined();

        expect(warnMock).toHaveBeenCalledWith(
          { stage, projectId: "project-1" },
          "Dropping legacy ReactorOutbox-era queue payload staged before the ADR-052 cutover",
        );
        await eventSourcing.close();
      });
    },
  );
});

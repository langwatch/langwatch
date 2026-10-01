/**
 * The framework's read-hint subscriber. Spec: packages/api/specs/read-hints.feature.
 */
import { describe, expect, it } from "vitest";

import { createTenantId } from "../../domain/tenantId.ts";
import {
  createReadHintsPipeline,
  publishReadHints,
  READ_HINT_COALESCE_MS,
  readHintDedupId,
} from "../read-hints.pipeline.ts";

function recordingPublish() {
  const published: { channel: string; message: unknown }[] = [];
  const publish = async (channel: string, message: string) => {
    published.push({ channel, message: JSON.parse(message) });
    return 1;
  };
  const hints = () =>
    published.map(({ channel, message }) => {
      const body = typeof message === "object" && message !== null ? message : {};
      const event = "event" in body && typeof body.event === "string" ? body.event : "{}";
      const tenantId = "tenantId" in body ? body.tenantId : undefined;
      return { channel, tenantId, event: JSON.parse(event) };
    });
  return { publish, published, hints };
}

const scopeGraphByOrganization = [{ path: "organization.getScopeGraph", scope: "organizationId" }];

describe("publishReadHints", () => {
  /** @scenario "A committed event a read names publishes one hint per read and tenant" */
  it("publishes the path on the read_invalidated channel under the scoped field's tenant", async () => {
    const { publish, hints } = recordingPublish();

    await publishReadHints({
      targets: scopeGraphByOrganization,
      data: { projectId: "p1", organizationId: "acme" },
      tenantId: "p1",
      publish,
    });

    expect(hints()).toEqual([
      {
        channel: "broadcast:read_invalidated",
        tenantId: "acme",
        event: { path: "organization.getScopeGraph" },
      },
    ]);
  });

  /** @scenario "A committed event a read names publishes one hint per read and tenant" */
  it("publishes a read and tenant named twice once", async () => {
    const { publish, published } = recordingPublish();

    await publishReadHints({
      targets: [...scopeGraphByOrganization, ...scopeGraphByOrganization],
      data: { organizationId: "acme" },
      tenantId: "p1",
      publish,
    });

    expect(published).toHaveLength(1);
  });

  /** @scenario "An unscoped read is hinted under the event's own tenant" */
  it("hints an unscoped read under the event's tenant", async () => {
    const { publish, hints } = recordingPublish();

    await publishReadHints({
      targets: [{ path: "organization.getScopeGraph" }],
      data: { grantId: "g1" },
      tenantId: "acme",
      publish,
    });

    expect(hints().map(({ tenantId }) => tenantId)).toEqual(["acme"]);
  });

  /** @scenario "A scoped event without that field publishes nothing for that read" */
  it("publishes nothing when the scoped field is absent or not a string", async () => {
    const { publish, published } = recordingPublish();

    await publishReadHints({
      targets: scopeGraphByOrganization,
      data: {},
      tenantId: "p1",
      publish,
    });
    await publishReadHints({
      targets: scopeGraphByOrganization,
      data: { organizationId: 7 },
      tenantId: "p1",
      publish,
    });

    expect(published).toEqual([]);
  });

  /** @scenario "A hint that cannot be published is retried, never dropped" */
  it("fails the handler when Redis refuses, so the lane retries", async () => {
    const refusing = async () => {
      throw new Error("READONLY You can't write against a read only replica.");
    };

    await expect(
      publishReadHints({
        targets: scopeGraphByOrganization,
        data: { organizationId: "acme" },
        tenantId: "p1",
        publish: refusing,
      }),
    ).rejects.toThrow("READONLY");
  });
});

describe("readHintDedupId", () => {
  /** @scenario "A burst of events for one read and tenant publishes one hint" */
  it("gives every event of one type for one hinted tenant the same id", () => {
    const idOf = (projectId: string, organizationId: string) =>
      readHintDedupId({
        eventType: "lw.project.created",
        targets: scopeGraphByOrganization,
        event: { tenantId: createTenantId(projectId), data: { projectId, organizationId } },
      });

    expect(idOf("p1", "acme")).toBe(idOf("p2", "acme"));
    expect(idOf("p1", "acme")).not.toBe(idOf("p3", "globex"));
    expect(READ_HINT_COALESCE_MS).toBe(1_000);
  });
});

describe("createReadHintsPipeline", () => {
  const hinted = new Map([["lw.project.created", scopeGraphByOrganization]]);

  it("builds one global pipeline for every hinted event", () => {
    const pipeline = createReadHintsPipeline({
      hinted,
      declaredEventTypes: new Set(["lw.project.created"]),
      publish: recordingPublish().publish,
    });

    expect(pipeline.metadata.name).toBe("read_hints");
  });

  /** @scenario "A read naming an event no installed pipeline declares is refused at boot" */
  it("refuses a read naming an event no installed pipeline declares, naming both", () => {
    const build = () =>
      createReadHintsPipeline({
        hinted,
        declaredEventTypes: new Set(["lw.organization.signed_up"]),
        publish: recordingPublish().publish,
      });

    expect(build).toThrow(
      expect.objectContaining({
        name: "ConfigurationError",
        details: expect.stringContaining("lw.project.created (organization.getScopeGraph)"),
      }),
    );
  });
});

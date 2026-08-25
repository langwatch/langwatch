import type { PresenceSession } from "@langwatch/presence-contract";
import { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { PresenceBroadcastPort } from "../src/ports/presence.port";
import { PresenceRepository } from "../src/repositories/presence.repository";
import { PresenceService } from "../src/services/presence.service";

const session: PresenceSession = {
  projectId: "project-1",
  sessionId: "tab-1",
  user: { id: "user-1", name: "Ada", image: null },
  location: { lens: "traces", route: { traceId: "trace-1" } },
  updatedAt: 1,
};

class StubRepository extends PresenceRepository {
  current: PresenceSession | null = null;
  upsert = vi.fn(async () => undefined);
  remove = vi.fn(async () => true);
  listByProject = vi.fn(async () => (this.current ? [this.current] : []));
  tryFindSession = vi.fn(async () => this.current);
}

class RecordingBroadcast extends PresenceBroadcastPort {
  publish = vi.fn(async () => undefined);
}

type StubProjects = ProjectService & { enabled: boolean };

function createProjects(): StubProjects {
  const projects = {
    enabled: true,
    isPresenceEnabled: async () => projects.enabled,
  };
  return projects as unknown as StubProjects;
}

function createService() {
  const repository = new StubRepository();
  const broadcast = new RecordingBroadcast();
  const projects = createProjects();
  const service = PresenceService.create({
    repository,
    broadcast,
    projects,
    now: () => 42,
  });
  return { service, repository, broadcast, projects };
}

describe("PresenceService", () => {
  it("uses the canonical Project service for the effective policy", async () => {
    const { service, projects } = createService();
    projects.enabled = false;
    await expect(
      service.isEnabledForProject({ projectId: "project-1" }),
    ).resolves.toBe(false);
  });

  it("persists and broadcasts the first session heartbeat", async () => {
    const { service, repository, broadcast } = createService();
    await expect(
      service.update({
        projectId: session.projectId,
        sessionId: session.sessionId,
        user: session.user,
        location: session.location,
      }),
    ).resolves.toMatchObject({
      updatedAt: 42,
    });
    expect(repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: 42 }),
      30,
    );
    expect(broadcast.publish).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "presence_updated" }),
    );
  });

  it("refreshes an unchanged session without broadcasting a delta", async () => {
    const { service, repository, broadcast } = createService();
    repository.current = session;
    await service.update({
      projectId: session.projectId,
      sessionId: session.sessionId,
      user: session.user,
      location: session.location,
    });
    expect(repository.upsert).toHaveBeenCalledOnce();
    expect(broadcast.publish).not.toHaveBeenCalled();
  });

  it("makes leave idempotent", async () => {
    const { service, repository, broadcast } = createService();
    repository.remove.mockResolvedValue(false);
    await service.leave({ projectId: "project-1", sessionId: "missing" });
    expect(broadcast.publish).not.toHaveBeenCalled();
  });

  it("publishes cursor ticks through the rate-limited channel", async () => {
    const { service, broadcast } = createService();
    await service.broadcastCursor({
      projectId: "project-1",
      sessionId: "tab-1",
      user: session.user,
      payload: { anchor: "trace:trace-1", x: 0.25, y: 0.75 },
    });
    expect(broadcast.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "presence_cursor",
        rateLimited: true,
      }),
    );
  });
});

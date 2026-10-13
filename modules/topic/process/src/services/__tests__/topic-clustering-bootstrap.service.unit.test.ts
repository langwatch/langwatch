import { describe, expect, it, vi } from "vitest";

import { MemoryTopicClusteringClaimRepository } from "../../repositories/memory/memory.topic-clustering-claim.repository.ts";
import type { TopicClusteringClaimRepository } from "../../repositories/topic-clustering-claim.repository.ts";
import {
  BOOTSTRAP_CLAIM_TTL_SECONDS,
  TopicClusteringBootstrapService,
} from "../topic-clustering-bootstrap.service.ts";

function commands() {
  return { requestClustering: vi.fn().mockResolvedValue(undefined) };
}

function unansweredClaims(): TopicClusteringClaimRepository {
  const unavailable = () => Promise.reject(new Error("connection refused"));
  return { claim: unavailable, release: unavailable, mark: unavailable, isMarked: unavailable };
}

describe("given a rate-limited topic clustering bootstrap", () => {
  describe("when a project is seen for the first time in the window", () => {
    /** @scenario "A project's clustering bootstrap is rate-limited to once per hour" */
    it("issues the bootstrap", async () => {
      const topicCommands = commands();

      await TopicClusteringBootstrapService.create({
        claims: MemoryTopicClusteringClaimRepository.create(),
        commands: topicCommands,
      }).bootstrap({ projectId: "project-1" });

      expect(topicCommands.requestClustering).toHaveBeenCalledWith({
        tenantId: "project-1",
        occurredAt: expect.any(Number),
        trigger: "bootstrap",
      });
    });

    it("claims main's per-project key with a TTL, so the window expires on its own", async () => {
      const claims = MemoryTopicClusteringClaimRepository.create();
      const claim = vi.spyOn(claims, "claim");

      await TopicClusteringBootstrapService.create({ claims, commands: commands() }).bootstrap({
        projectId: "project-1",
      });

      expect(claim).toHaveBeenCalledWith({
        key: "topic-clustering:bootstrap-claimed:project-1",
        ttlSeconds: BOOTSTRAP_CLAIM_TTL_SECONDS,
      });
    });
  });

  describe("when the same project is seen again inside the window", () => {
    /** @scenario "A project's clustering bootstrap is rate-limited to once per hour" */
    it("does not issue a second bootstrap", async () => {
      const topicCommands = commands();
      const gate = TopicClusteringBootstrapService.create({
        claims: MemoryTopicClusteringClaimRepository.create(),
        commands: topicCommands,
      });

      await gate.bootstrap({ projectId: "project-1" });
      await gate.bootstrap({ projectId: "project-1" });
      await gate.bootstrap({ projectId: "project-1" });

      expect(topicCommands.requestClustering).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a different project is seen inside the window", () => {
    it("is claimed independently", async () => {
      const topicCommands = commands();
      const gate = TopicClusteringBootstrapService.create({
        claims: MemoryTopicClusteringClaimRepository.create(),
        commands: topicCommands,
      });

      await gate.bootstrap({ projectId: "project-1" });
      await gate.bootstrap({ projectId: "project-2" });

      expect(topicCommands.requestClustering.mock.calls.map(([input]) => input.tenantId)).toEqual([
        "project-1",
        "project-2",
      ]);
    });
  });

  describe("when the claims store is unavailable", () => {
    /** @scenario "A project's clustering bootstrap fails open when the claim cannot be taken" */
    it("bootstraps anyway rather than risking an unscheduled project", async () => {
      const topicCommands = commands();

      await TopicClusteringBootstrapService.create({
        claims: unansweredClaims(),
        commands: topicCommands,
      }).bootstrap({ projectId: "project-1" });

      expect(topicCommands.requestClustering).toHaveBeenCalledWith({
        tenantId: "project-1",
        occurredAt: expect.any(Number),
        trigger: "bootstrap",
      });
    });
  });

  describe("when the bootstrap itself throws", () => {
    it("propagates, so the caller decides how to report it", async () => {
      const topicCommands = commands();
      topicCommands.requestClustering.mockRejectedValueOnce(new Error("store down"));

      await expect(
        TopicClusteringBootstrapService.create({
          claims: MemoryTopicClusteringClaimRepository.create(),
          commands: topicCommands,
        }).bootstrap({ projectId: "project-1" }),
      ).rejects.toThrow("store down");
    });
  });
});

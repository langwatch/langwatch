/**
 * The AWS connections: sealed secrets, and the refusal to delete one a plan or a stop still uses.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryAgentStopPlanRepository } from "../../../../repositories/memory/memory.agent-stop-plan.repository.ts";
import { MemoryAgentStopRepository } from "../../../../repositories/memory/memory.agent-stop.repository.ts";
import { MemoryGovernanceAwsConnectionRepository } from "../../../../repositories/memory/memory.governance-aws-connection.repository.ts";
import { GovernanceAwsConnectionService } from "../governance-aws-connection.service.ts";
import { KillSwitchAuditService } from "../kill-switch-audit.service.ts";
import { ORG } from "./kill-switch.fixtures.ts";

function connectionService(
  repository: MemoryGovernanceAwsConnectionRepository,
  plans = MemoryAgentStopPlanRepository.create(),
  stops = MemoryAgentStopRepository.create(),
  audit: RecordAuditLogCommand[] = [],
  newExternalId?: () => string,
) {
  const auditLog = createApiFixture<AuditLogApi>({
    record: async (command) => {
      audit.push(command);
      return { id: `audit-${audit.length}`, occurredAt: 0 };
    },
  });
  return GovernanceAwsConnectionService.create({
    connections: repository,
    plans,
    stops,
    audit: KillSwitchAuditService.create({ auditLog, outbox: () => undefined }),
    ...(newExternalId ? { newExternalId } : {}),
  });
}

describe("GovernanceAwsConnectionService", () => {
  describe("when a connection with an access key pair is stored", () => {
    /** @scenario "An AWS connection stores its secret key encrypted and never answers it" */
    it("seals the secret access key and answers only the access key id's last four characters", async () => {
      const repository = MemoryGovernanceAwsConnectionRepository.create();
      const service = connectionService(repository);

      const view = await service.createConnection({
        organizationId: ORG,
        userId: "user-ops",
        connection: {
          name: "ACME production",
          accessKeyId: "AKIAACMEEXAMPLE0001",
          secretAccessKey: "acme-secret-access-key-0001",
        },
      });

      const [row] = repository.testing.storedRows();
      expect(row?.encryptedSecretAccessKey).not.toBeNull();
      expect(row?.encryptedSecretAccessKey).not.toContain("acme-secret-access-key-0001");
      expect(view).toEqual({
        id: view.id,
        name: "ACME production",
        accessKeyIdLastFour: "0001",
        roleArn: null,
        externalId: null,
        createdAt: view.createdAt,
      });
      const listed = await service.findConnections({ organizationId: ORG });
      expect(JSON.stringify(listed)).not.toContain("acme-secret-access-key-0001");
      expect(await repository.getCredentials({ organizationId: ORG, id: view.id })).toMatchObject({
        secretAccessKey: "acme-secret-access-key-0001",
      });
    });
  });

  describe("when a connection names only a role and the caller sends its own external id", () => {
    /** @scenario "An AWS connection may name a role to assume instead of a key pair" */
    it("ignores the caller's id and seals one LangWatch generates", async () => {
      const repository = MemoryGovernanceAwsConnectionRepository.create();
      const service = connectionService(
        repository,
        undefined,
        undefined,
        undefined,
        () => "langwatch-generated-0001",
      );
      const callerChosen = {
        name: "ACME role",
        roleArn: "arn:aws:iam::123456789012:role/langwatch-kill-switch",
        externalId: "acme-chosen-id",
      };

      const view = await service.createConnection({
        organizationId: ORG,
        userId: "user-ops",
        connection: callerChosen,
      });

      expect(view).toMatchObject({
        accessKeyIdLastFour: null,
        roleArn: "arn:aws:iam::123456789012:role/langwatch-kill-switch",
        externalId: "langwatch-generated-0001",
      });
      expect(await repository.getCredentials({ organizationId: ORG, id: view.id })).toMatchObject({
        externalId: "langwatch-generated-0001",
      });
      const [row] = repository.testing.storedRows();
      expect(row?.accessKeyId).toBeNull();
      expect(row?.encryptedSecretAccessKey).toBeNull();
      expect(row?.encryptedExternalId).not.toContain("langwatch-generated-0001");
      expect(JSON.stringify(row)).not.toContain("acme-chosen-id");
    });
  });

  describe("when a stop plan target still signs with the connection", () => {
    /** @scenario "An AWS connection a stop plan or an unrestored stop still uses cannot be deleted" */
    it("refuses the delete with governance_aws_connection_in_use and keeps the connection", async () => {
      const repository = MemoryGovernanceAwsConnectionRepository.create();
      const plans = MemoryAgentStopPlanRepository.create();
      const service = connectionService(repository, plans);
      const view = await service.createConnection({
        organizationId: ORG,
        userId: "user-ops",
        connection: { name: "ACME role", roleArn: "arn:aws:iam::123456789012:role/kill-switch" },
      });
      await plans.replaceTargets({
        organizationId: ORG,
        agentId: "agent-1",
        targets: [
          {
            id: "target-1",
            label: "live alias",
            target: {
              kind: "bedrock_agent_alias",
              awsConnectionId: view.id,
              region: "eu-west-1",
              agentId: "AGENT00001",
              agentAliasId: "ALIAS00001",
            },
          },
        ],
      });

      const refusal = await service
        .deleteConnection({ organizationId: ORG, connectionId: view.id, userId: "user-ops" })
        .then(
          () => undefined,
          (error: { code?: string; meta?: unknown }) => error,
        );

      expect(refusal?.code).toBe("governance_aws_connection_in_use");
      expect(refusal?.meta).toEqual({ connectionId: view.id, agentIds: ["agent-1"] });
      expect(await service.findConnections({ organizationId: ORG })).toHaveLength(1);

      await plans.replaceTargets({ organizationId: ORG, agentId: "agent-1", targets: [] });
      expect(
        await service.deleteConnection({
          organizationId: ORG,
          connectionId: view.id,
          userId: "user-ops",
        }),
      ).toEqual({ deleted: true });
    });
  });

  describe("when a connection is added and then removed", () => {
    /** @scenario "Adding and removing an AWS connection is audited without its secrets" */
    it("audits both writes with the connection as target and no secret", async () => {
      const repository = MemoryGovernanceAwsConnectionRepository.create();
      const service = connectionService(repository);
      const audit = repository.auditIntents;

      const view = await service.createConnection({
        organizationId: ORG,
        userId: "user-ops",
        connection: {
          name: "ACME production",
          accessKeyId: "AKIAACMEEXAMPLE0001",
          secretAccessKey: "acme-secret-access-key-0001",
        },
      });
      await service.deleteConnection({
        organizationId: ORG,
        connectionId: view.id,
        userId: "user-ops",
      });
      await service.deleteConnection({
        organizationId: ORG,
        connectionId: view.id,
        userId: "user-ops",
      });

      expect(audit.map((row) => [row.action, row.targetKind, row.targetId, row.userId])).toEqual([
        [
          "governance.agent.aws_connection_created",
          "governance_aws_connection",
          view.id,
          "user-ops",
        ],
        [
          "governance.agent.aws_connection_deleted",
          "governance_aws_connection",
          view.id,
          "user-ops",
        ],
      ]);
      expect(audit[0]?.metadata).toEqual({
        targetName: "ACME production",
        name: "ACME production",
        accessKeyIdLastFour: "0001",
        roleArn: null,
        hasExternalId: false,
      });
      expect(JSON.stringify(audit)).not.toContain("acme-secret-access-key-0001");
    });
  });

  describe("when a delete is refused because a stop plan still uses the connection", () => {
    /** @scenario "A refused kill switch write is still audited" */
    it("records the refused attempt with its error code and the person who asked", async () => {
      const repository = MemoryGovernanceAwsConnectionRepository.create();
      const plans = MemoryAgentStopPlanRepository.create();
      const recorded: RecordAuditLogCommand[] = [];
      const service = connectionService(repository, plans, undefined, recorded);
      const view = await service.createConnection({
        organizationId: ORG,
        userId: "user-ops",
        connection: { name: "ACME role", roleArn: "arn:aws:iam::123456789012:role/kill-switch" },
      });
      await plans.replaceTargets({
        organizationId: ORG,
        agentId: "agent-1",
        targets: [
          {
            id: "target-1",
            label: "live alias",
            target: {
              kind: "bedrock_agent_alias",
              awsConnectionId: view.id,
              region: "eu-west-1",
              agentId: "AGENT00001",
              agentAliasId: "ALIAS00001",
            },
          },
        ],
      });

      await expect(
        service.deleteConnection({
          organizationId: ORG,
          connectionId: view.id,
          userId: "user-ops",
        }),
      ).rejects.toMatchObject({ code: "governance_aws_connection_in_use" });

      expect(recorded).toEqual([
        expect.objectContaining({
          userId: "user-ops",
          organizationId: ORG,
          action: "governance.agent.aws_connection_deleted",
          error: "governance_aws_connection_in_use",
          targetKind: "governance_aws_connection",
          targetId: view.id,
        }),
      ]);
    });
  });

  describe("when an operator impersonating a person adds a connection", () => {
    /** @scenario "An impersonated kill switch write names the operator in its audit row" */
    it("names the person as the actor and the operator in the actor column and the metadata", async () => {
      const repository = MemoryGovernanceAwsConnectionRepository.create();
      const service = connectionService(repository);

      await service.createConnection({
        organizationId: ORG,
        userId: "user-ops",
        impersonatorId: "operator-1",
        connection: { name: "ACME role", roleArn: "arn:aws:iam::123456789012:role/kill-switch" },
      });

      expect(repository.auditIntents).toEqual([
        expect.objectContaining({
          userId: "user-ops",
          actorUserId: "operator-1",
          metadata: expect.objectContaining({ impersonatorId: "operator-1" }),
        }),
      ]);
    });
  });

  describe("when the audit append of a delete fails", () => {
    /** @scenario "An AWS connection write commits only together with its audit row" */
    it("keeps the connection, and the retry deletes it with its audit row", async () => {
      const repository = MemoryGovernanceAwsConnectionRepository.create();
      const service = connectionService(repository);
      repository.testing.refuseNextAudit("outbox unavailable");
      await expect(
        service.createConnection({
          organizationId: ORG,
          userId: "user-ops",
          connection: { name: "ACME staging", roleArn: "arn:aws:iam::123456789012:role/acme" },
        }),
      ).rejects.toThrow("outbox unavailable");
      expect(await service.findConnections({ organizationId: ORG })).toEqual([]);
      const view = await service.createConnection({
        organizationId: ORG,
        userId: "user-ops",
        connection: { name: "ACME staging", roleArn: "arn:aws:iam::123456789012:role/acme" },
      });

      repository.testing.refuseNextAudit("outbox unavailable");
      const refused = service.deleteConnection({
        organizationId: ORG,
        connectionId: view.id,
        userId: "user-ops",
      });

      await expect(refused).rejects.toThrow("outbox unavailable");
      expect((await service.findConnections({ organizationId: ORG })).map((row) => row.id)).toEqual(
        [view.id],
      );
      expect(
        await service.deleteConnection({
          organizationId: ORG,
          connectionId: view.id,
          userId: null,
        }),
      ).toEqual({ deleted: true });
      expect(repository.auditIntents.map((row) => row.action)).toEqual([
        "governance.agent.aws_connection_created",
        "governance.agent.aws_connection_deleted",
      ]);
    });
  });
});

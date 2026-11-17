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
import { ORG } from "./kill-switch.fixtures.ts";

function connectionService(
  repository: MemoryGovernanceAwsConnectionRepository,
  plans = MemoryAgentStopPlanRepository.create(),
  stops = MemoryAgentStopRepository.create(),
  audit: RecordAuditLogCommand[] = [],
) {
  const auditLog = createApiFixture<AuditLogApi>({
    record: async (command) => {
      audit.push(command);
      return { id: `audit-${audit.length}`, occurredAt: 0 };
    },
  });
  return GovernanceAwsConnectionService.create({ connections: repository, plans, stops, auditLog });
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

      const [row] = repository.storedRows();
      expect(row?.encryptedSecretAccessKey).not.toBeNull();
      expect(row?.encryptedSecretAccessKey).not.toContain("acme-secret-access-key-0001");
      expect(view).toEqual({
        id: view.id,
        name: "ACME production",
        accessKeyIdLastFour: "0001",
        roleArn: null,
        hasExternalId: false,
        createdAt: view.createdAt,
      });
      const listed = await service.findConnections({ organizationId: ORG });
      expect(JSON.stringify(listed)).not.toContain("acme-secret-access-key-0001");
      expect(await repository.getCredentials({ organizationId: ORG, id: view.id })).toMatchObject({
        secretAccessKey: "acme-secret-access-key-0001",
      });
    });
  });

  describe("when a connection names only a role and an external id", () => {
    /** @scenario "An AWS connection may name a role to assume instead of a key pair" */
    it("stores it with no key pair and the external id sealed", async () => {
      const repository = MemoryGovernanceAwsConnectionRepository.create();
      const service = connectionService(repository);

      const view = await service.createConnection({
        organizationId: ORG,
        userId: "user-ops",
        connection: {
          name: "ACME role",
          roleArn: "arn:aws:iam::123456789012:role/langwatch-kill-switch",
          externalId: "acme-external-id",
        },
      });

      expect(view).toMatchObject({
        accessKeyIdLastFour: null,
        roleArn: "arn:aws:iam::123456789012:role/langwatch-kill-switch",
        hasExternalId: true,
      });
      const [row] = repository.storedRows();
      expect(row?.accessKeyId).toBeNull();
      expect(row?.encryptedSecretAccessKey).toBeNull();
      expect(row?.encryptedExternalId).not.toContain("acme-external-id");
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
      const audit: RecordAuditLogCommand[] = [];
      const service = connectionService(
        MemoryGovernanceAwsConnectionRepository.create(),
        undefined,
        undefined,
        audit,
      );

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
        name: "ACME production",
        accessKeyIdLastFour: "0001",
        roleArn: null,
        hasExternalId: false,
      });
      expect(JSON.stringify(audit)).not.toContain("acme-secret-access-key-0001");
    });
  });
});

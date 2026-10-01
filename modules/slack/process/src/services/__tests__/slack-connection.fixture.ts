import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzPermission } from "@langwatch/authorization";
import type { OrganizationSettings } from "@langwatch/organization-contract";
import type { ProjectIdentity } from "@langwatch/project-contract";
import type { SlackApi } from "@langwatch/slack-contract";

import { MemorySlackWebApiChannel } from "../../channels/memory/memory.slack-web-api.channel.ts";
import { MemorySlackRepositories } from "../../repositories/memory/memory.slack.repositories.ts";
import type { SlackConnectionRepository } from "../../repositories/slack-connection.repository.ts";
import { SlackConnectionClaimService } from "../slack-connection-claim.service.ts";
import { SlackConnectionService } from "../slack-connection.service.ts";

export const ORG = "org_1";
export const PROJECT = "project_a";
export const OTHER_PROJECT = "project_b";
export const MANAGER = "user_manager";
export const VIEWER = "user_viewer";

const projects: Record<string, ProjectIdentity> = {
  [PROJECT]: identity({ id: PROJECT, name: "Alpha" }),
  [OTHER_PROJECT]: identity({ id: OTHER_PROJECT, name: "Beta" }),
};

function identity({ id, name }: { id: string; name: string }): ProjectIdentity {
  return {
    id,
    name,
    slug: id,
    teamId: "team_1",
    organizationId: ORG,
    isPersonal: false,
    ownerUserId: null,
  };
}

function settings({ organizationId }: { organizationId: string }): OrganizationSettings {
  const at = new Date("2026-09-30T00:00:00Z");
  return {
    id: organizationId,
    name: "Acme",
    slug: "acme",
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3Bucket: null,
    createdAt: at,
    updatedAt: at,
  };
}

/** Hex, not a cipher: a stored row that spells out the plaintext fails the tests. */
const hexCipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8").toString("hex"),
  decrypt: (value: string) => Buffer.from(value, "hex").toString("utf8"),
};

/** The service over memory twins; MANAGER holds every permission, VIEWER none. */
export function composeSlack({ connections }: { connections?: SlackConnectionRepository } = {}) {
  const memory = MemorySlackRepositories.create();
  const repositories = connections ? { ...memory, connections } : memory;
  const webApi = MemorySlackWebApiChannel.create();
  const service = SlackConnectionService.create({
    connections: repositories.connections,
    claims: repositories.claims,
    projects: {
      listNamesByIds: ({ projectIds }) =>
        Promise.resolve(projectIds.flatMap((id) => (projects[id] ? [projects[id]] : []))),
    },
    organizations: { getSettings: (input) => Promise.resolve(settings(input)) },
    authorization: {
      hasPermission: ({ userId }: { userId: string; permission: AuthzPermission }) =>
        Promise.resolve(userId === MANAGER),
    },
    webApi,
    cipher: hexCipher,
    fingerprintKey: "test-key",
  });
  const claims = SlackConnectionClaimService.create({
    claims: repositories.claims,
    connections: service,
  });
  return { service, claims, repositories, webApi };
}

/** `SlackApi` over the composed services, as a transport test mounts it. */
export function composeSlackApi() {
  const slack = composeSlack();
  const { service, claims } = slack;
  const api = createApiFixture<SlackApi>({
    listSlackConnections: (input) => service.listSlackConnections(input),
    createSlackConnection: (input) => service.createSlackConnection(input),
    updateSlackConnection: (input) => service.updateSlackConnection(input),
    deleteSlackConnection: (input) => service.deleteSlackConnection(input),
    getUsableSlackConnection: (input) => service.getUsableSlackConnection(input),
    findUsableSlackSecret: (input) => service.findUsableSlackSecret(input),
    findOrCreateSlackConnectionForSecret: (input) =>
      service.findOrCreateSlackConnectionForSecret(input),
    claimConnection: (input) => claims.claimConnection(input),
    releaseConnection: (input) => claims.releaseConnection(input),
  });
  return { ...slack, api };
}

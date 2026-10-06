import type { RestCaller, RestIdentity } from "@langwatch/api/hosting";
import {
  bindRestMiddleware,
  projectCredentialOfRequest,
  recordProjectCredential,
} from "@langwatch/api/rest";
import type { RestResolvedProjectCredential } from "@langwatch/authorization";

import { connectCallerOf } from "../../rules/agent-connect-caller.rules.ts";
import { agentConnectCredentials } from "../agent-connect.rest.ts";

/** The project credential the stand-in door resolves: a personal key of the test project. */
export const CONNECT_TEST_CREDENTIAL: RestResolvedProjectCredential = {
  type: "apiKey",
  apiKeyId: "key_test",
  userId: "user_test",
  organizationId: "org_test",
  ingestSourceType: null,
  ingestionTemplateId: null,
  project: {
    id: "project_test",
    name: "Test project",
    slug: "test-project",
    teamId: "team_test",
    organizationId: "org_test",
    isPersonal: false,
    ownerUserId: null,
  },
};

/** A project door that admits the test credential, or throws the refusal it was handed. */
export function connectDoor({ refusal }: { refusal?: Error } = {}): RestIdentity {
  return {
    authenticate: ({ request }): RestCaller => {
      if (refusal) throw refusal;
      recordProjectCredential(request, CONNECT_TEST_CREDENTIAL);
      return {
        actor: { type: "user", id: "user_test" },
        scope: { tier: "project", id: CONNECT_TEST_CREDENTIAL.project.id },
      };
    },
  };
}

/** The connect facts as the agent module binds them, off what the door recorded. */
export const connectCredentialsFact = bindRestMiddleware(agentConnectCredentials, (context) => ({
  caller: connectCallerOf(projectCredentialOfRequest(context.req.raw)),
  instanceToken: context.req.header("x-agent-instance-token"),
}));

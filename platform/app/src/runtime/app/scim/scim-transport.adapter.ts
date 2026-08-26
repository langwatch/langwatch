// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ScimService } from "@langwatch/enterprise-scim-contract";
import {
  CREATE_GROUP,
  CREATE_USER,
  DELETE_GROUP,
  DELETE_USER,
  GET_GROUP,
  GET_SERVICE_PROVIDER_CONFIG,
  GET_USER,
  LIST_GROUPS,
  LIST_RESOURCE_TYPES,
  LIST_SCHEMAS,
  LIST_USERS,
  PATCH_GROUP,
  PATCH_USER,
  REPLACE_GROUP,
  REPLACE_USER,
  ScimWebhookApi,
} from "@langwatch/enterprise-scim-server";

/** API-process SCIM transport metadata; routes consume the composed App service. */
export const scimTransportOperations = {
  createGroup: CREATE_GROUP,
  createUser: CREATE_USER,
  deleteGroup: DELETE_GROUP,
  deleteUser: DELETE_USER,
  getGroup: GET_GROUP,
  getServiceProviderConfig: GET_SERVICE_PROVIDER_CONFIG,
  getUser: GET_USER,
  listGroups: LIST_GROUPS,
  listResourceTypes: LIST_RESOURCE_TYPES,
  listSchemas: LIST_SCHEMAS,
  listUsers: LIST_USERS,
  patchGroup: PATCH_GROUP,
  patchUser: PATCH_USER,
  replaceGroup: REPLACE_GROUP,
  replaceUser: REPLACE_USER,
} as const;

/** One API-process adapter for Auth0 webhook delivery to the composed SCIM service. */
export class AppScimWebhookAdapter {
  private constructor(private readonly webhookApi: ScimWebhookApi) {}

  static create(): AppScimWebhookAdapter {
    return new AppScimWebhookAdapter(ScimWebhookApi.create());
  }

  handle(service: ScimService, events: unknown[]): Promise<void> {
    return this.webhookApi.handle({ service, events });
  }
}

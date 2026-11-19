/**
 * `privateModelEndpoint.*` (ADR-203). Organization managers list endpoints and bind hostnames;
 * staff register, change and remove endpoints from ops. Only the staff procedures carry addresses.
 */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  organizationPrivateModelEndpointSchema,
  privateModelEndpointBindInputSchema,
  privateModelEndpointBindingSchema,
  privateModelEndpointOrganizationInputSchema,
  privateModelEndpointRebindInputSchema,
  privateModelEndpointRegisterInputSchema,
  privateModelEndpointRemoveInputSchema,
  privateModelEndpointUnbindInputSchema,
  privateModelEndpointUpdateInputSchema,
  staffPrivateModelEndpointSchema,
} from "./private-model-endpoint.ts";

export const privateModelEndpointTrpc = defineTrpcContract("privateModelEndpoint")
  /** The organization's endpoints with their bound hostnames, never their addresses. */
  .query("listForOrganization")
  .withInput(privateModelEndpointOrganizationInputSchema)
  .withOutput(z.array(organizationPrivateModelEndpointSchema))

  .mutation("bind")
  .withInput(privateModelEndpointBindInputSchema)
  .withOutput(privateModelEndpointBindingSchema)

  .mutation("rebind")
  .withInput(privateModelEndpointRebindInputSchema)
  .withOutput(privateModelEndpointBindingSchema)

  .mutation("unbind")
  .withInput(privateModelEndpointUnbindInputSchema)

  /** Ops: one organization's endpoints, addresses included. */
  .query("listForStaff")
  .withInput(privateModelEndpointOrganizationInputSchema)
  .withOutput(z.array(staffPrivateModelEndpointSchema))

  .mutation("register")
  .withInput(privateModelEndpointRegisterInputSchema)
  .withOutput(staffPrivateModelEndpointSchema)

  .mutation("update")
  .withInput(privateModelEndpointUpdateInputSchema)
  .withOutput(staffPrivateModelEndpointSchema)

  /** Removes the endpoint and every binding to it. */
  .mutation("remove")
  .withInput(privateModelEndpointRemoveInputSchema)
  .build();

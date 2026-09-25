/** The `identityLookup.*` procedures main's back-office identity lookup calls (D05). */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  identityLookupAddressSchema,
  identityLookupAnswerSchema,
  lookupDomainClaimSchema,
  lookupInvitationExpirySchema,
  lookupOperatorActivityRowSchema,
  lookupPersonDetailSchema,
} from "./identity-lookup.ts";

const invitationInputSchema = z.object({
  organizationId: z.string().min(1),
  inviteId: z.string().min(1),
});

export const identityLookupTrpc = defineTrpcContract("identityLookup")
  .query("resolve")
  .withInput(z.object({ address: identityLookupAddressSchema }))
  .withOutput(identityLookupAnswerSchema)

  .query("person")
  .withInput(z.object({ userId: z.string().min(1), address: identityLookupAddressSchema }))
  .withOutput(lookupPersonDetailSchema.nullable())

  .query("recentActivity")
  .withInput(z.object({}))
  .withOutput(z.array(lookupOperatorActivityRowSchema))

  .query("claimQueue")
  .withInput(z.object({}))
  .withOutput(z.array(lookupDomainClaimSchema))

  .mutation("detachMethod")
  .withInput(z.object({ userId: z.string().min(1), identifierId: z.string().min(1) }))
  .withOutput(z.void())

  .mutation("endSessions")
  .withInput(
    z.object({
      userId: z.string().min(1),
      /** Null ends every session; an id ends one method's. */
      identifierId: z.string().min(1).nullable().default(null),
    }),
  )
  .withOutput(z.void())

  .mutation("resendInvitation")
  .withInput(invitationInputSchema)
  .withOutput(lookupInvitationExpirySchema)

  .mutation("extendInvitation")
  .withInput(invitationInputSchema)
  .withOutput(lookupInvitationExpirySchema)
  .build();

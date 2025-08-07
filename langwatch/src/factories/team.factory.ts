import { type Team } from "@prisma/client";
import { Factory } from "fishery";
import { nanoid } from "nanoid";

export const teamFactory = Factory.define<Team>(({ sequence }) => ({
  id: nanoid(),
  name: `Test Team ${sequence}`,
  slug: `test-team-${sequence}-${nanoid()}`,
  organizationId: nanoid(),
  createdAt: new Date(),
  updatedAt: new Date(),
}));

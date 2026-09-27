/**
 * What the composition root takes from auth and organization, loaded through
 * their declarations before anything renders (ARCHITECTURE.md 10.1).
 */

import { authWeb } from "@langwatch/auth-browser/declaration";
import { organizationWeb } from "@langwatch/organization-browser/declaration";

const auth = authWeb.installation.capabilities;
const organization = organizationWeb.installation.capabilities;

export type UiRootCapabilities = {
  session: Awaited<ReturnType<typeof auth.session.load>>;
  frontDoorTheme: Awaited<ReturnType<typeof auth.frontDoorTheme.load>>;
  scope: Awaited<ReturnType<typeof organization.scope.load>>;
  organizationFacts: Awaited<ReturnType<typeof organization.organizationFacts.load>>;
};

export async function loadUiRootCapabilities(): Promise<UiRootCapabilities> {
  const [session, frontDoorTheme, scope, organizationFacts] = await Promise.all([
    auth.session.load(),
    auth.frontDoorTheme.load(),
    organization.scope.load(),
    organization.organizationFacts.load(),
  ]);
  return { session, frontDoorTheme, scope, organizationFacts };
}

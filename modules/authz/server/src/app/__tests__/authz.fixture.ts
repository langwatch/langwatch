/**
 * Test builders for the AuthZ application.
 *
 * The app is still composed from the two contract services rather than from
 * repositories (`adapters/postgres.authz.adapter.ts` is what a process builds
 * them with), so a test states the slice of each it exercises and the builder
 * refuses every other member by name instead of answering undefined.
 */
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import { AuthzApp } from "../authz.app.ts";

function statedOrRefusing<Service extends object>(name: string, stated: object): Service {
  return new Proxy(stated as Service, {
    get(target, member, receiver) {
      if (Reflect.has(target, member)) return Reflect.get(target, member, receiver);

      throw new Error(`the AuthZ test app has no ${name}.${String(member)}`);
    },
  });
}

/** An app over exactly the service members a test states. */
export function createAuthzTestApp(
  services: Readonly<{
    permissions?: Partial<AuthzService>;
    grants?: Partial<AuthzGrantsService>;
  }> = {},
): AuthzApp {
  return AuthzApp.fromServices({
    permissions: statedOrRefusing<AuthzService>("permissions", services.permissions ?? {}),
    grants: statedOrRefusing<AuthzGrantsService>("grants", services.grants ?? {}),
  });
}

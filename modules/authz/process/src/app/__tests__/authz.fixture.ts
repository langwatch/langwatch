/**
 * Test builders for the AuthZ application, composed from the decision service
 * and the contract grants service (`AuthzModule.create` composes from repositories): a
 * test states the slice it exercises, and the builder refuses the rest.
 */
import type { AuthzGrantsService, AuthzServerConfig } from "@langwatch/authz-contract";

import type { AuthzService } from "../../services/authz.service.ts";
import { AuthzModule } from "../authz.app.ts";

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
    config?: AuthzServerConfig | undefined;
  }> = {},
): AuthzModule {
  return AuthzModule.fromServices({
    permissions: statedOrRefusing<Pick<AuthzService, keyof AuthzService>>(
      "permissions",
      services.permissions ?? {},
    ),
    grants: statedOrRefusing<AuthzGrantsService>("grants", services.grants ?? {}),
    config: services.config,
  });
}

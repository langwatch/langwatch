/**
 * Binds the three suite REST declarations to this process's project-key door.
 * Two facts stand behind the routes that need them: what the project is called,
 * which the door itself binds, and which surface the request came from, which
 * is a header only these families read.
 */
import { bindRestHeader, type MountableRestApp, type RestErrorHandler } from "@langwatch/api/rest";
import type { SuiteApi } from "@langwatch/suite-contract";
import {
  createRunPlansRest,
  createSuitesAliasRest,
  createTestSuitesRest,
  suiteSurfaceFact,
  suitesAliasErrorHandler,
} from "@langwatch/suite-server";
import type { PlatformUrlBuilder } from "@langwatch/api/rest";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** `/api/v1/run-plans`, `/api/v1/test-suites` and the `/api/suites` alias. */
export function mountSuiteRest(
  runtime: ApiRestRuntime,
  options: {
    suites: () => SuiteApi;
    platformUrl: PlatformUrlBuilder;
    /** The process's own error envelope, which two of the three answer in. */
    errors: RestErrorHandler;
  },
): readonly MountableRestApp[] {
  // Which surface asked. The project facts the same routes read are the door's
  // own, so this is the only binding these families make.
  const facts = [bindRestHeader(suiteSurfaceFact, "x-langwatch-surface")];

  return [
    runtime.mount(createRunPlansRest(options.platformUrl).router(), options.suites, {
      onError: options.errors,
      facts,
    }),
    runtime.mount(createTestSuitesRest(options.platformUrl).router(), options.suites, {
      onError: options.errors,
      facts,
    }),
    runtime.mount(createSuitesAliasRest(options.platformUrl).router(), options.suites, {
      onError: suitesAliasErrorHandler(options.errors),
      facts,
    }),
  ];
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineServerModule } from "@langwatch/runtime-composition";

import { SsoApp } from "./app/sso.app.ts";
import { ssoConnectionTrpcTransport } from "./transport/sso-connection.trpc.ts";

export const ssoServer = defineServerModule("sso")
  .withApp(SsoApp)
  .withTransports(ssoConnectionTrpcTransport)
  .build();

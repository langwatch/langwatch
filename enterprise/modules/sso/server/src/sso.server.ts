// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineModule } from "@langwatch/runtime-composition";

import { SsoApp } from "./app/sso.app.ts";
import { ssoConnectionTrpcTransport } from "./transport/sso-connection.trpc.ts";

export const ssoServer = defineModule("sso")
  .withApp(SsoApp)
  .withTransports(ssoConnectionTrpcTransport)
  .build();

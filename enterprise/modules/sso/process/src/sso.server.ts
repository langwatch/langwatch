// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineServerModule } from "@langwatch/kernel";

import { SsoApp } from "./app/sso.app.ts";
import { ssoConnectionTrpcTransport } from "./transport/sso-connection.trpc.ts";
import { ssoSetupTrpcTransport } from "./transport/sso-setup.trpc.ts";

export const ssoServer = defineServerModule("sso")
  .withApp(SsoApp)
  .withTransports(ssoConnectionTrpcTransport, ssoSetupTrpcTransport);

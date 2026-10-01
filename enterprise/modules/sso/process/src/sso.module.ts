// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineProcessModule } from "@langwatch/process";

import { SsoModule } from "./app/sso.app.ts";
import { ssoConnectionTrpcTransport } from "./transport/sso-connection.trpc.ts";
import { ssoSetupTrpcTransport } from "./transport/sso-setup.trpc.ts";

export const ssoProcessModule = defineProcessModule("sso")
  .withApi(SsoModule)
  .withTransports(ssoConnectionTrpcTransport, ssoSetupTrpcTransport);

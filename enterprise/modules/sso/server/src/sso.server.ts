// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineFeature } from "@langwatch/runtime-composition";

import { SsoApp } from "./app/sso.app.ts";
import { ssoConnectionTrpcTransport } from "./transport/sso-connection.trpc.ts";

export const ssoServer = defineFeature("sso")
  .withApp(SsoApp)
  .withTransports(ssoConnectionTrpcTransport)
  .build();

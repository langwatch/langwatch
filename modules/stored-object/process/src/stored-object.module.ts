import { defineProcessModule } from "@langwatch/process";

import { StoredObjectModule } from "#app/stored-object.app";
import { storedObjectChannels } from "#channels/stored-object-channels.registry";
import { storedObjectRepositories } from "#repositories/stored-object-repositories.registry";
import { storedObjectFileRest } from "#transport/stored-object-file.rest";
import { storedObjectImageProxyRest } from "#transport/stored-object-image-proxy.rest";
import { storedObjectRest } from "#transport/stored-object.rest";
import { storedObjectTrpcTransport } from "#transport/stored-object.trpc";

export const storedObjectProcessModule = defineProcessModule("stored-object")
  .withRepositories(storedObjectRepositories)
  .withChannels(storedObjectChannels)
  .withApi(StoredObjectModule)
  .withTransports(
    storedObjectRest,
    storedObjectFileRest,
    storedObjectImageProxyRest,
    storedObjectTrpcTransport,
  );

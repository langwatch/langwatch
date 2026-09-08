import { defineFeature } from "@langwatch/runtime-composition";
import { StoredObjectApp } from "#app/stored-object.app";
import { storedObjectRepositories } from "#repositories/stored-object-repositories.registry";
import { storedObjectRest } from "#transport/stored-object.rest";
import { storedObjectTrpcTransport } from "#transport/stored-object.trpc";

export const storedObjectServer = defineFeature("stored-object")
  .withRepositories(storedObjectRepositories)
  .withApp(StoredObjectApp)
  .withTransports(storedObjectRest, storedObjectTrpcTransport)
  .build();

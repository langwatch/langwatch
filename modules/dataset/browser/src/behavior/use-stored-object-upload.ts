import type {
  CreateDatasetFromStoredObjectInput,
  DatasetImportStarted,
} from "@langwatch/dataset-contract";
import type { StoredObjectReference } from "@langwatch/stored-object-contract";
import { useMemo } from "react";

import { datasetApi } from "./dataset-api.ts";
import { type StoredObjectUploadTransport, uploadStoredObject } from "./stored-object-upload.ts";

/** The stored-object upload procedures, bound to the application's tRPC transport. */
export function useStoredObjectUploadTransport(): StoredObjectUploadTransport {
  const createUpload = datasetApi.storedObjects.createUpload.useMutation();
  const confirmUpload = datasetApi.storedObjects.confirmUpload.useMutation();
  return useMemo(
    () => ({
      createUpload: createUpload.mutateAsync,
      confirmUpload: confirmUpload.mutateAsync,
    }),
    [createUpload.mutateAsync, confirmUpload.mutateAsync],
  );
}

/** What importing one file into a new dataset calls: the upload, then the dataset's own import. */
export type DatasetImportTransport = {
  uploadStoredObject: (params: {
    projectId: string;
    purpose: string;
    file: File;
    signal?: AbortSignal;
  }) => Promise<StoredObjectReference>;
  createFromStoredObject: (
    input: CreateDatasetFromStoredObjectInput,
  ) => Promise<DatasetImportStarted>;
};

export function useDatasetImportTransport(): DatasetImportTransport {
  const transport = useStoredObjectUploadTransport();
  const createFromStoredObject = datasetApi.dataset.createFromStoredObject.useMutation();
  return useMemo(
    () => ({
      uploadStoredObject: (params) => uploadStoredObject({ ...params, transport }),
      createFromStoredObject: createFromStoredObject.mutateAsync,
    }),
    [transport, createFromStoredObject.mutateAsync],
  );
}

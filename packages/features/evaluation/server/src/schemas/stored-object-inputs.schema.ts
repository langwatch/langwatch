import { z } from "zod";

export const STORED_OBJECT_MARKER_KEY = "__lw_stored_object" as const;

export interface StoredObjectInputsMarker {
  [STORED_OBJECT_MARKER_KEY]: {
    id: string;
    sizeBytes: number;
    sha256: string | null;
    preview: string;
    truncatedPreview: boolean;
    ceilingExceeded?: boolean;
    offloadFailed?: boolean;
  };
}

const storedObjectMarkerSchema = z
  .object({
    [STORED_OBJECT_MARKER_KEY]: z.object({ id: z.string() }).passthrough(),
  })
  .passthrough();

export function isStoredObjectMarker(value: unknown): value is StoredObjectInputsMarker {
  return storedObjectMarkerSchema.safeParse(value).success;
}

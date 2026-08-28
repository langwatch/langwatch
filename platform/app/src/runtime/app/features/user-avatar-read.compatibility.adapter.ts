import { Readable } from "node:stream";
import {
  StoredObjectBytesMissingError,
  StoredObjectNotFoundError,
  type StoredObjectService,
} from "@langwatch/stored-object-contract";
import type { StoredObjectsService } from "~/server/stored-objects/stored-objects.service";

export type UserAvatarStoredObjectRead =
  | {
      status: "available";
      metadata: {
        byteLength: number;
        mediaType: string;
        purpose: string;
        ownerKind: string;
      };
      stream: Readable;
    }
  | {
      status: "missing";
      metadata: {
        byteLength: number;
        mediaType: string;
        purpose: string;
        ownerKind: string;
      };
    }
  | null;

/** Temporary historical-read bridge while retired avatar rows remain live. */
export class AppUserAvatarReadCompatibilityAdapter {
  static create(input: {
    canonical: StoredObjectService;
    historical: StoredObjectsService;
  }): AppUserAvatarReadCompatibilityAdapter {
    return new AppUserAvatarReadCompatibilityAdapter(input.canonical, input.historical);
  }

  private constructor(
    private readonly canonical: StoredObjectService,
    private readonly historical: StoredObjectsService,
  ) {}

  async getById(input: { projectId: string; id: string }): Promise<UserAvatarStoredObjectRead> {
    try {
      const result = await this.canonical.getById(input);
      return {
        status: "available",
        metadata: canonicalMetadata(result.metadata),
        stream: Readable.from(binaryChunks(result.bytes)),
      };
    } catch (error) {
      if (error instanceof StoredObjectBytesMissingError) {
        return {
          status: "missing",
          metadata: canonicalMetadata(await this.canonical.getMetadata(input)),
        };
      }
      if (!(error instanceof StoredObjectNotFoundError)) throw error;
    }

    const historical = await this.historical.getById(input);
    if (!historical) return null;

    const metadata = {
      byteLength: historical.row.size_bytes,
      mediaType: historical.row.media_type,
      purpose: historical.row.purpose,
      ownerKind: historical.row.owner_kind,
    };
    if (!("stream" in historical)) return { status: "missing", metadata };

    return { status: "available", metadata, stream: historical.stream };
  }
}

function canonicalMetadata(metadata: {
  byteLength: number;
  mediaType: string;
  provenance: { purpose: string; ownerKind: string };
}) {
  return {
    byteLength: metadata.byteLength,
    mediaType: metadata.mediaType,
    purpose: metadata.provenance.purpose,
    ownerKind: metadata.provenance.ownerKind,
  };
}

async function* binaryChunks(bytes: AsyncIterable<Uint8Array>): AsyncGenerator<Buffer> {
  for await (const chunk of bytes) {
    yield Buffer.from(chunk);
  }
}

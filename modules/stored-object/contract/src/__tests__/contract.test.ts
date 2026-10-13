import { HandledError } from "@langwatch/handled-error";
import { describe, expect, expectTypeOf, it } from "vitest";
import { ZodError } from "zod";

import {
  DirectUploadUnavailableError,
  IdempotencyConflictError,
  StorageUnavailableError,
  StoredObjectBytesMissingError,
  StoredObjectDeletedError,
  StoredObjectNotFoundError,
  UploadTooLargeError,
  mapLegacyStoredObjectPurposeToAudience,
  storedObjectIdentitySchema,
  storedObjectProblemSchema,
  storedObjectReferenceSchema,
  storedObjectsCreateUploadInputSchema,
  storedObjectsInternalRpc,
  storedObjectsPublicRpc,
  type StoredObjectApi,
  type StoredObjectByteSource,
  type StoredObjectReference,
} from "../index.ts";

const SHA256 = "a".repeat(64);
function reference(overrides: Partial<StoredObjectReference> = {}): StoredObjectReference {
  return {
    projectId: "project_1",
    id: "prod_so_1",
    sha256: SHA256,
    byteLength: 12,
    filename: "report.pdf",
    mediaType: "application/pdf",
    audience: "project:view",
    ...overrides,
  };
}

describe("Stored Objects validation contract", () => {
  it("accepts canonical upload metadata", () => {
    expect(
      storedObjectsCreateUploadInputSchema.parse({
        projectId: "project_1",
        filename: "report.pdf",
        mediaType: "application/pdf",
        byteLength: 12,
        purpose: "dataset_attachment",
      }),
    ).toEqual({
      projectId: "project_1",
      filename: "report.pdf",
      mediaType: "application/pdf",
      byteLength: 12,
      purpose: "dataset_attachment",
    });

    expect(() =>
      storedObjectsCreateUploadInputSchema.parse({
        filename: "report.pdf",
        mediaType: "application/pdf",
        byteLength: 12,
        purpose: "dataset_attachment",
      }),
    ).toThrow(ZodError);
  });

  it.each([
    ["empty purpose", { purpose: "" }],
    ["negative byte length", { byteLength: -1 }],
    ["fractional byte length", { byteLength: 1.5 }],
    ["filename controls", { filename: "report\n.pdf" }],
    ["media type controls", { mediaType: "text/plain\r" }],
    ["non-ASCII media type", { mediaType: "text/pläin" }],
  ])("rejects %s", (_case, overrides) => {
    expect(() =>
      storedObjectsCreateUploadInputSchema.parse({
        projectId: "project_1",
        filename: "report.pdf",
        mediaType: "application/pdf",
        byteLength: 12,
        purpose: "dataset_attachment",
        ...overrides,
      }),
    ).toThrow(ZodError);
  });

  it("normalizes filenames before enforcing their UTF-8 byte ceiling", () => {
    expect(
      storedObjectsCreateUploadInputSchema.parse({
        projectId: "project_1",
        filename: "Cafe\u0301.pdf",
        mediaType: "application/pdf",
        byteLength: 12,
        purpose: "dataset_attachment",
      }).filename,
    ).toBe("Café.pdf");

    expect(() =>
      storedObjectsCreateUploadInputSchema.parse({
        projectId: "project_1",
        filename: "é".repeat(128),
        mediaType: "application/pdf",
        byteLength: 12,
        purpose: "dataset_attachment",
      }),
    ).toThrow(ZodError);
  });
});

describe("Stored Objects IDs and references", () => {
  it("validates the project and stable content ID as one scoped identity", () => {
    expect(
      storedObjectIdentitySchema.parse({
        projectId: "project_1",
        id: "prod_so_1",
      }),
    ).toEqual({ projectId: "project_1", id: "prod_so_1" });
    expect(() => storedObjectIdentitySchema.parse({ projectId: "project_1", id: "" })).toThrow(
      ZodError,
    );
  });

  it("keeps presentation metadata and audience but rejects persisted URLs", () => {
    expect(storedObjectReferenceSchema.parse(reference())).toEqual(reference());
    expect(() =>
      storedObjectReferenceSchema.parse({
        ...reference(),
        deliveryUrl: "https://storage.example/private-token",
      }),
    ).toThrow(/Unrecognized key/u);
  });

  it("maps only recognized legacy purposes to their closed audience", () => {
    expect(mapLegacyStoredObjectPurposeToAudience("scenario_event")).toBe("scenarios:view");
    expect(mapLegacyStoredObjectPurposeToAudience("trace_content")).toBe("traces:view");
    expect(mapLegacyStoredObjectPurposeToAudience("evaluation_inputs")).toBe("evaluations:view");
    expect(mapLegacyStoredObjectPurposeToAudience("unknown")).toBeUndefined();
  });
});

describe("Stored Objects command and query contracts", () => {
  it("keeps all control RPCs POST-only with exact coarse permissions", () => {
    expect(Object.values(storedObjectsPublicRpc).map(({ method }) => method)).toEqual([
      "POST",
      "POST",
      "POST",
      "POST",
    ]);
    expect(storedObjectsPublicRpc.createUpload.permission).toBe("project:update");
    expect(storedObjectsPublicRpc.confirmUpload.permission).toBe("project:update");
    expect(storedObjectsPublicRpc.get).toMatchObject({
      permission: "project:view",
      audienceProof: true,
    });
    expect(storedObjectsPublicRpc.delete.permission).toBe("project:manage");
    expect(Object.keys(storedObjectsInternalRpc)).toEqual(["metadata", "availability", "delivery"]);
  });
});

describe("Stored Objects errors and portable service capability", () => {
  it.each([
    [new DirectUploadUnavailableError(), 503, "direct_upload_unavailable"],
    [new UploadTooLargeError(11, 10), 413, "upload_too_large"],
    [new StoredObjectDeletedError("project_1", "prod_so_1"), 410, "stored_object_deleted"],
    [new StoredObjectNotFoundError(), 404, "stored_object_not_found"],
    [new StoredObjectBytesMissingError("project_1", "prod_so_1"), 404, "stored_object_missing"],
    [new StorageUnavailableError(), 502, "storage_unavailable"],
    [new IdempotencyConflictError(), 409, "idempotency_conflict"],
  ] as const)("serializes %s as a handled problem", (error, status, code) => {
    expect(HandledError.isHandled(error)).toBe(true);
    expect(error).toMatchObject({ httpStatus: status, code });
    const serialized = error.serialize();
    expect(
      storedObjectProblemSchema.parse({
        ...serialized,
        message: error.message,
      }),
    ).toMatchObject({ code, fault: error.fault });
  });

  describe("when a serialized problem crosses the transport boundary", () => {
    it("keeps the retryable verdict the writer sent", () => {
      expect(
        storedObjectProblemSchema.parse({
          code: "storage_unavailable",
          message: "Object storage is temporarily unavailable.",
          retryable: true,
        }).retryable,
      ).toBe(true);
    });

    it("reads an envelope that omits the verdict as not retryable", () => {
      expect(
        storedObjectProblemSchema.parse({
          code: "stored_object_not_found",
          message: "The stored object was not found.",
        }).retryable,
      ).toBe(false);
    });

    it("still rejects a key the envelope does not define", () => {
      expect(() =>
        storedObjectProblemSchema.parse({
          code: "stored_object_not_found",
          message: "The stored object was not found.",
          deliveryUrl: "https://storage.example/private-token",
        }),
      ).toThrow(/Unrecognized key/u);
    });
  });

  it("does not put provider locators in portable storage failures", () => {
    expect(new StorageUnavailableError().serialize().meta).toEqual({});
    expect(new StoredObjectNotFoundError().serialize().meta).toEqual({});
  });

  it("exposes only portable byte primitives", () => {
    expectTypeOf<StoredObjectByteSource>().toEqualTypeOf<Uint8Array | AsyncIterable<Uint8Array>>();
    expectTypeOf<
      Awaited<ReturnType<StoredObjectApi["storeFromBytes"]>>["reference"]
    >().toEqualTypeOf<StoredObjectReference>();
  });
});

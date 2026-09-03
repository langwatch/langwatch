import {
  getStoredObjectStorageScheme,
  mintAzureBlobStoredObjectUri,
  mintFileStoredObjectUri,
  mintS3StoredObjectUri,
  redactStoredObjectAuthorizationMaterial,
  redactStoredObjectStorageErrorText,
  redactStoredObjectStorageUri,
  redactStoredObjectStorageUrisInText,
} from "../index";
import { describe, expect, it } from "vitest";

describe("stored object storage URIs", () => {
  it("keeps S3 object paths content-addressed by project and digest", () => {
    expect(
      mintS3StoredObjectUri({
        bucket: "my-bucket",
        projectId: "proj-abc",
        sha256: "deadbeef1234",
      }),
    ).toBe("s3://my-bucket/proj-abc/deadbeef1234");
  });

  it("normalizes local roots without changing the object path", () => {
    expect(
      mintFileStoredObjectUri({
        root: "var/lib/langwatch/objects",
        projectId: "proj-abc",
        sha256: "deadbeef1234",
      }),
    ).toBe("file:///var/lib/langwatch/objects/proj-abc/deadbeef1234");
  });

  it("keeps the Azure account and container in the URI authority", () => {
    expect(
      mintAzureBlobStoredObjectUri({
        accountName: "account",
        container: "stored-objects",
        projectId: "proj-abc",
        sha256: "deadbeef1234",
      }),
    ).toBe("azure-blob://account/stored-objects/proj-abc/deadbeef1234");
  });

  it("recognizes only configured object driver schemes", () => {
    expect(getStoredObjectStorageScheme("s3://my-bucket/proj/sha")).toBe("s3");
    expect(() => getStoredObjectStorageScheme("gs://bucket/object")).toThrow(
      /Unrecognised URI scheme/,
    );
  });

  it("redacts tenant storage destinations and authorization material", () => {
    expect(redactStoredObjectStorageUri("S3://customer-private/proj-abc/sha256")).toBe(
      "S3://***/proj-abc/sha256",
    );
    expect(
      redactStoredObjectStorageUrisInText(
        "failed at gs://customer-private/proj-abc/sha256: 404",
      ),
    ).toBe("failed at gs://***/proj-abc/sha256: 404");
    expect(
      redactStoredObjectAuthorizationMaterial(
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890",
      ),
    ).toContain("Bearer ***");
  });

  it("redacts shared keys and signed XML details", () => {
    const sharedKey = "Authorization: SharedKey lwacct:aGVsbG8rc2lnbmF0dXJl=";
    const xml =
      '<AuthenticationErrorDetail xml:space="preserve">MAC signature over GET</AuthenticationErrorDetail>';

    expect(redactStoredObjectAuthorizationMaterial(sharedKey)).toBe(
      "Authorization: SharedKey ***",
    );
    expect(redactStoredObjectAuthorizationMaterial(xml)).toBe(
      "<AuthenticationErrorDetail>***</AuthenticationErrorDetail>",
    );
  });

  it("redacts token fields without corrupting structured text", () => {
    const token =
      "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJzdG9yYWdlIn0.signature";
    const json = `{"token_type":"Bearer","access_token":"${token}"}`;
    const form = `grant_type=client_credentials&client_assertion=${token}&scope=x`;
    const redactedJson = redactStoredObjectAuthorizationMaterial(json);

    expect(JSON.parse(redactedJson)).toEqual({
      token_type: "Bearer",
      access_token: "***",
    });
    expect(redactStoredObjectAuthorizationMaterial(form)).not.toContain(token);
  });

  it("redacts both the destination and credential on an error path", () => {
    const token = "abcdefghijklmnopqrstuvwxyz1234567890";
    const error =
      `failed on azure-blob://lwacct/private/proj-1/abc123 ` + `with Bearer ${token}`;
    const redacted = redactStoredObjectStorageErrorText(error);

    expect(redacted).not.toContain("lwacct/private");
    expect(redacted).not.toContain(token);
  });

  it("does not redact ordinary prose that merely names an auth scheme", () => {
    const text = "SharedKey authentication is disabled on this storage account.";

    expect(redactStoredObjectAuthorizationMaterial(text)).toBe(text);
  });
});

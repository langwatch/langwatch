/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  assertMigrationPhaseMatchesActiveProvider,
  parseMigrationTaskConfig,
  parseMigrationTaskPhase,
  resolveMigrationS3Region,
} from "../migrateObjectStorage";

const validEnvironment = (): NodeJS.ProcessEnv => ({
  OBJECT_STORAGE_MIGRATION_SOURCE_PROVIDER: "s3",
  OBJECT_STORAGE_MIGRATION_TARGET_PROVIDER: "azure",
  OBJECT_STORAGE_MIGRATION_S3_BUCKET: "source",
  OBJECT_STORAGE_MIGRATION_S3_REGION: "eu-west-1",
  OBJECT_STORAGE_MIGRATION_S3_ACCESS_KEY_ID: "access",
  OBJECT_STORAGE_MIGRATION_S3_SECRET_ACCESS_KEY: "secret",
  OBJECT_STORAGE_MIGRATION_AZURE_ACCOUNT_NAME: "destination",
  OBJECT_STORAGE_MIGRATION_AZURE_CONTAINER: "langwatch",
  OBJECT_STORAGE_MIGRATION_AZURE_AUTH_MODE: "sharedKey",
  OBJECT_STORAGE_MIGRATION_AZURE_ACCOUNT_KEY: "azure-secret",
});

describe("migrateObjectStorage task configuration", () => {
  it("accepts explicit credentials that are isolated from active app storage", () => {
    const config = parseMigrationTaskConfig(validEnvironment());

    expect(config).toMatchObject({
      sourceProvider: "s3",
      targetProvider: "azure",
      writesPaused: false,
      s3: { bucket: "source", region: "eu-west-1" },
      azure: {
        accountName: "destination",
        container: "langwatch",
        authMode: "sharedKey",
      },
    });
  });

  it("requires different source and target providers", () => {
    expect(() =>
      parseMigrationTaskConfig({
        ...validEnvironment(),
        OBJECT_STORAGE_MIGRATION_TARGET_PROVIDER: "s3",
      }),
    ).toThrow(/source and target providers must differ/);
  });

  it("rejects mixed Azure shared-key and token authentication", () => {
    expect(() =>
      parseMigrationTaskConfig({
        ...validEnvironment(),
        OBJECT_STORAGE_MIGRATION_AZURE_AUTH_MODE: "managedIdentity",
      }),
    ).toThrow(/must not include an account key/);
  });

  it.each([
    "plan",
    "copy",
    "finalize",
    "verify",
  ] as const)("accepts the %s phase", (phase) => {
    expect(parseMigrationTaskPhase(phase)).toBe(phase);
  });

  it("rejects an unknown phase before making changes", () => {
    expect(() => parseMigrationTaskPhase("delete-source")).toThrow(
      /plan.*copy.*finalize.*verify/,
    );
  });

  it("refuses copy when the configured source is not the active app storage", () => {
    const config = parseMigrationTaskConfig(validEnvironment());

    expect(() =>
      assertMigrationPhaseMatchesActiveProvider({
        phase: "copy",
        config,
        activeEnvironment: {
          STORED_OBJECTS_BACKEND: "azure",
          AZURE_BLOB_ACCOUNT_NAME: "destination",
          AZURE_BLOB_CONTAINER: "langwatch",
        },
      }),
    ).toThrow(/expects s3.*but azure is active/);
  });

  it("refuses to copy from a different active S3 bucket", () => {
    const config = parseMigrationTaskConfig(validEnvironment());

    expect(() =>
      assertMigrationPhaseMatchesActiveProvider({
        phase: "copy",
        config,
        activeEnvironment: {
          STORED_OBJECTS_BACKEND: "s3",
          S3_BUCKET_NAME: "another-bucket",
        },
      }),
    ).toThrow(/expects active S3 bucket "source"/);
  });

  it("refuses to copy from a different active provider endpoint", () => {
    const config = parseMigrationTaskConfig({
      ...validEnvironment(),
      OBJECT_STORAGE_MIGRATION_S3_ENDPOINT:
        "https://migration-s3.example.test/",
    });

    expect(() =>
      assertMigrationPhaseMatchesActiveProvider({
        phase: "copy",
        config,
        activeEnvironment: {
          STORED_OBJECTS_BACKEND: "s3",
          S3_BUCKET_NAME: "source",
          S3_ENDPOINT: "https://active-s3.example.test",
        },
      }),
    ).toThrow(/active S3 endpoint.*match/);
  });

  it("requires verify to run against the deployed destination", () => {
    const config = parseMigrationTaskConfig(validEnvironment());

    expect(() =>
      assertMigrationPhaseMatchesActiveProvider({
        phase: "verify",
        config,
        activeEnvironment: {
          STORED_OBJECTS_BACKEND: "s3",
          S3_BUCKET_NAME: "source",
        },
      }),
    ).toThrow(/verify expects azure.*but s3 is active/);

    expect(() =>
      assertMigrationPhaseMatchesActiveProvider({
        phase: "verify",
        config,
        activeEnvironment: {
          STORED_OBJECTS_BACKEND: "azure",
          AZURE_BLOB_ACCOUNT_NAME: "destination",
          AZURE_BLOB_CONTAINER: "langwatch",
        },
      }),
    ).not.toThrow();
  });

  it("accepts equivalent normalized Azure endpoints after cutover", () => {
    const config = parseMigrationTaskConfig({
      ...validEnvironment(),
      OBJECT_STORAGE_MIGRATION_AZURE_ENDPOINT:
        "https://destination.blob.core.windows.net/",
    });

    expect(() =>
      assertMigrationPhaseMatchesActiveProvider({
        phase: "verify",
        config,
        activeEnvironment: {
          STORED_OBJECTS_BACKEND: "azure",
          AZURE_BLOB_ACCOUNT_NAME: "destination",
          AZURE_BLOB_CONTAINER: "langwatch",
        },
      }),
    ).not.toThrow();
  });

  it("lets AWS resolve its region chain when no migration region is supplied", () => {
    const environment = validEnvironment();
    delete environment.OBJECT_STORAGE_MIGRATION_S3_REGION;
    const config = parseMigrationTaskConfig(environment);

    expect(config.s3.region).toBeUndefined();
    expect(resolveMigrationS3Region(config.s3)).toBeUndefined();
    expect(resolveMigrationS3Region({ region: "eu-west-1" })).toBe("eu-west-1");
    expect(
      resolveMigrationS3Region({
        endpoint: "https://object.example.test",
      }),
    ).toBe("auto");
    expect(
      resolveMigrationS3Region({
        endpoint: "https://s3.eu-west-1.amazonaws.com",
      }),
    ).toBeUndefined();
    expect(
      resolveMigrationS3Region({
        endpoint: "https://s3.cn-north-1.amazonaws.com.cn",
      }),
    ).toBeUndefined();
  });
});

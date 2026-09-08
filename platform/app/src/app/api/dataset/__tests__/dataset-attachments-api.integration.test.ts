/**
 * @vitest-environment node
 * @integration
 *
 * The dataset attachment upload route and the read that serves the file back.
 *
 * The object store is real: a `StoredObjectsService` wired to the local
 * filesystem driver over a per-test temp directory, with an in-memory row
 * store standing in for ClickHouse. So the bytes are written, deduplicated and
 * streamed back for real; only the row table and the rate limiter are stubs.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { LocalFilesystemDriver } from "~/server/stored-objects/local-filesystem-driver";
import { StorageRegistry } from "~/server/stored-objects/storage-registry";
import type { StoredObject } from "~/server/stored-objects/stored-object";
import type { StoredObjectsRepository } from "~/server/stored-objects/stored-objects.repository";
import {
  type MintStorageUri,
  StoredObjectsService,
} from "~/server/stored-objects/stored-objects.service";
import { mintFileUri } from "~/server/stored-objects/uri";
import { DATASET_ATTACHMENT_MAX_BYTES } from "~/shared/datasets/attachment-policy";

// ---------------------------------------------------------------------------
// Hoisted state and mocks
// ---------------------------------------------------------------------------

const {
  rows,
  insertedRowCount,
  mockGetServerAuthSession,
  mockProbeProjectPermission,
  storageRoot,
} = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  insertedRowCount: { value: 0 },
  mockGetServerAuthSession: vi.fn(),
  mockProbeProjectPermission: vi.fn(),
  storageRoot: { path: "" },
}));

/** An in-memory stand-in for the ClickHouse row table. */
const repository = {
  async insert({ projectId, row }: { projectId: string; row: StoredObject }) {
    insertedRowCount.value += 1;
    rows.set(`${projectId}:${row.id}`, row);
  },
  async findById({ projectId, id }: { projectId: string; id: string }) {
    return (rows.get(`${projectId}:${id}`) as StoredObject | undefined) ?? null;
  },
} as unknown as StoredObjectsRepository;

const mintStorageUri: MintStorageUri = async ({ projectId, sha256 }) =>
  mintFileUri({ root: storageRoot.path, projectId, sha256 });

vi.mock("~/server/stored-objects/stored-objects-factory", () => ({
  createStoredObjectsService: () => {
    const driver = new LocalFilesystemDriver();
    return new StoredObjectsService(
      repository,
      new StorageRegistry({ file: driver, s3: driver }),
      mintStorageUri,
    );
  },
  createStorageRegistry: () => {
    const driver = new LocalFilesystemDriver();
    return new StorageRegistry({ file: driver, s3: driver });
  },
}));

vi.mock("~/server/auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getServerAuthSession: (...args: unknown[]) =>
    mockGetServerAuthSession(...args),
}));

vi.mock(
  "~/server/app-layer/permissions/imperative",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    probeProjectPermission: (...args: unknown[]) =>
      mockProbeProjectPermission(...args),
  }),
);

// Redis is not part of what these cases exercise; the read route's per-caller
// limiter always allows so the read path itself is what is under test.
vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60_000,
  }),
}));

// Imported after the mocks so both apps resolve the stubbed factory.
const { app: datasetApp } = await import("../[[...route]]/app");
const { app: filesApp } = await import("../../files/[[...route]]/app");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("Feature: Attach files to dataset cells", () => {
  let organization: Organization;
  let team: Team;
  let project: Project;
  let apiKey: string;

  beforeAll(async () => {
    storageRoot.path = await fs.mkdtemp(
      path.join(os.tmpdir(), "dataset-attachments-"),
    );
  });

  afterAll(async () => {
    await fs.rm(storageRoot.path, { recursive: true, force: true });
  });

  beforeEach(async () => {
    rows.clear();
    insertedRowCount.value = 0;
    mockGetServerAuthSession.mockResolvedValue(null);
    mockProbeProjectPermission.mockResolvedValue(true);

    organization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `test-org-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
    apiKey = project.apiKey;
  });

  afterEach(async () => {
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    vi.clearAllMocks();
  });

  function attachmentForm({
    content,
    fileName,
    mediaType,
    datasetId,
  }: {
    content: string;
    fileName: string;
    mediaType: string;
    datasetId?: string;
  }): FormData {
    const form = new FormData();
    form.append("file", new Blob([content], { type: mediaType }), fileName);
    if (datasetId) form.append("datasetId", datasetId);
    return form;
  }

  /** Uploads as a project API key caller unless `session` is asked for. */
  async function upload(
    form: FormData,
    options: { session?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = options.session
      ? { "sec-fetch-site": "same-origin" }
      : { "X-Auth-Token": apiKey };
    return await datasetApp.request(
      `/api/dataset/attachments?projectId=${project.id}`,
      { method: "POST", headers, body: form },
    );
  }

  describe("given a file on my computer", () => {
    describe("when I upload it to my project", () => {
      /** @scenario "Uploading a file into a project stores it once and returns a reference" */
      it("stores the file once and answers with a reference to it", async () => {
        const form = attachmentForm({
          content: "a-small-picture",
          fileName: "receipt.png",
          mediaType: "image/png",
        });

        const response = await upload(form);
        expect(response.status).toBe(200);

        const body = (await response.json()) as {
          url: string;
          name: string;
          mediaType: string;
          sizeBytes: number;
        };
        expect(body.url).toMatch(
          new RegExp(`^/api/files/${project.id}/[^/]+/receipt\\.png$`),
        );
        expect(body.name).toBe("receipt.png");
        expect(body.mediaType).toBe("image/png");
        expect(body.sizeBytes).toBe("a-small-picture".length);
        expect(insertedRowCount.value).toBe(1);

        const again = await upload(
          attachmentForm({
            content: "a-small-picture",
            fileName: "receipt.png",
            mediaType: "image/png",
          }),
        );
        const againBody = (await again.json()) as { url: string };
        expect(againBody.url).toBe(body.url);
        expect(insertedRowCount.value).toBe(1);
      });

      /** @scenario "The reference carries the file name and serves the file with its media type" */
      it("serves the file back under its own name and media type", async () => {
        const response = await upload(
          attachmentForm({
            content: "a-small-picture",
            fileName: "receipt.png",
            mediaType: "image/png",
          }),
        );
        const { url } = (await response.json()) as { url: string };

        const read = await filesApp.request(url, {
          headers: { "X-Auth-Token": apiKey },
        });

        expect(read.status).toBe(200);
        expect(read.headers.get("Content-Type")).toBe("image/png");
        expect(read.headers.get("Content-Disposition")).toBe(
          'inline; filename="receipt.png"',
        );
        expect(await read.text()).toBe("a-small-picture");
      });

      /** @scenario "An API key caller can upload" */
      it("accepts a project API key", async () => {
        const response = await upload(
          attachmentForm({
            content: "notes",
            fileName: "notes.txt",
            mediaType: "text/plain",
          }),
        );

        expect(response.status).toBe(200);
        expect(insertedRowCount.value).toBe(1);
      });
    });
  });

  describe("given a file a browser can run", () => {
    describe("when I upload it to my project", () => {
      /** @scenario "A media type that can run in the browser is refused" */
      it.each([
        ["page.html", "text/html"],
        ["logo.svg", "image/svg+xml"],
        ["script.js", "application/javascript"],
      ])("refuses %s", async (fileName, mediaType) => {
        const response = await upload(
          attachmentForm({ content: "<b>x</b>", fileName, mediaType }),
        );

        expect(response.status).toBe(415);
        const body = (await response.json()) as { error: string };
        expect(body.error).toBe("dataset_attachment_type_refused");
        expect(insertedRowCount.value).toBe(0);
      });
    });
  });

  describe("given credentials that cannot manage datasets", () => {
    describe("when I upload a file to my project", () => {
      /** @scenario "A caller without permission to manage datasets cannot upload" */
      it("refuses the upload and stores nothing", async () => {
        mockGetServerAuthSession.mockResolvedValue({
          user: { id: `user_${nanoid()}` },
        });
        mockProbeProjectPermission.mockResolvedValue(false);

        const response = await upload(
          attachmentForm({
            content: "notes",
            fileName: "notes.txt",
            mediaType: "text/plain",
          }),
          { session: true },
        );

        expect(response.status).toBe(403);
        expect(insertedRowCount.value).toBe(0);
      });
    });
  });

  describe("given a file over the upload limit", () => {
    describe("when the request body is larger than the cap", () => {
      it("refuses it before the file is read", async () => {
        const response = await datasetApp.request(
          `/api/dataset/attachments?projectId=${project.id}`,
          {
            method: "POST",
            headers: {
              "X-Auth-Token": apiKey,
              "Content-Type": "multipart/form-data; boundary=x",
              "Content-Length": String(DATASET_ATTACHMENT_MAX_BYTES * 4),
            },
            body: "not-actually-that-long",
          },
        );

        expect(response.status).toBe(413);
        const body = (await response.json()) as { error: string };
        expect(body.error).toBe("dataset_attachment_too_large");
      });
    });
  });
});

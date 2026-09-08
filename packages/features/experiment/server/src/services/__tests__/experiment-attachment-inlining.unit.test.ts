/**
 * Which cell values become bytes before a target is dispatched, and which are
 * left exactly as the row holds them.
 * @see specs/experiments-v3/dataset-attachments.feature
 */
import type { ExecutionCell } from "@langwatch/experiment-contract";
import { describe, expect, it, vi } from "vitest";
import { ExperimentAttachmentInliningService } from "../experiment-attachment-inlining.service.ts";
import { attachmentInputFields } from "../../rules/experiment-attachment.rules.ts";
import { UnavailableExperimentAttachmentAdapter } from "../../adapters/unavailable-experiment-attachment.adapter.ts";
import type { ExperimentAttachmentPort } from "../../ports/experiment-attachment.port.ts";

const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";

const datasetColumns = [
  { id: "col_1", name: "question", type: "string" },
  { id: "col_2", name: "photo", type: "image" },
  { id: "col_3", name: "document", type: "file" },
];

/** A cell whose target maps one input per dataset column, by column name. */
const makeCell = (entry: Record<string, unknown>): ExecutionCell =>
  ({
    rowIndex: 0,
    targetId: "target-1",
    targetConfig: {
      id: "target-1",
      type: "prompt",
      inputs: [
        { identifier: "question", type: "str" },
        { identifier: "picture", type: "image" },
        { identifier: "report", type: "file" },
      ],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {
        "dataset-1": {
          question: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "question",
          },
          picture: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "photo",
          },
          report: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "document",
          },
        },
      },
    },
    evaluatorConfigs: [],
    datasetEntry: { _datasetId: "dataset-1", ...entry },
  }) as unknown as ExecutionCell;

const storeHolding = (
  rows: Record<string, { bytes: Buffer; mediaType: string }>,
): { port: ExperimentAttachmentPort; tryRead: ReturnType<typeof vi.fn> } => {
  const tryRead = vi.fn<
    (input: {
      projectId: string;
      id: string;
    }) => Promise<{ bytes: Buffer; mediaType: string } | null>
  >(async ({ id }) => rows[id] ?? null);

  return { port: { tryRead } as unknown as ExperimentAttachmentPort, tryRead };
};

/** Builds the inputs the way the run does: mapped values, then inlining. */
const inline = async ({
  entry,
  port,
}: {
  entry: Record<string, unknown>;
  port: ExperimentAttachmentPort;
}): Promise<Record<string, unknown>> => {
  const cell = makeCell(entry);
  const inputs = {
    question: entry.question,
    picture: entry.photo,
    report: entry.document,
  };

  return ExperimentAttachmentInliningService.create({ attachments: port }).inlineInputs({
    projectId: PROJECT,
    inputs,
    fields: attachmentInputFields({ cell, datasetColumns }),
  });
};

describe("given a row whose columns are typed image and file", () => {
  describe("when the run builds the target's inputs", () => {
    /** @scenario "An uploaded picture in an image column reaches the target as its bytes" */
    it("replaces the stored reference with the picture's bytes", async () => {
      const { port } = storeHolding({
        obj_1: { bytes: Buffer.from("PNGBYTES"), mediaType: "image/png" },
      });

      const inputs = await inline({
        entry: { question: "what is this?", photo: `/api/files/${PROJECT}/obj_1` },
        port,
      });

      expect(inputs.picture).toBe(
        `data:image/png;base64,${Buffer.from("PNGBYTES").toString("base64")}`,
      );
      expect(inputs.question).toBe("what is this?");
    });

    /** @scenario "An uploaded document in a file column reaches the target as its bytes" */
    it("replaces a markdown-linked reference with the document's bytes", async () => {
      const { port } = storeHolding({
        obj_2: { bytes: Buffer.from("%PDF-1.4"), mediaType: "application/pdf" },
      });

      const inputs = await inline({
        entry: { document: `[report.pdf](/api/files/${PROJECT}/obj_2)` },
        port,
      });

      expect(inputs.report).toBe(
        `data:application/pdf;base64,${Buffer.from("%PDF-1.4").toString("base64")}`,
      );
    });

    /** @scenario "A reference to another project's attachment is left as text" */
    it("leaves a reference belonging to another project untouched and reads no bytes", async () => {
      const { port, tryRead } = storeHolding({
        obj_3: { bytes: Buffer.from("PNGBYTES"), mediaType: "image/png" },
      });
      const foreign = `/api/files/${OTHER_PROJECT}/obj_3`;

      const inputs = await inline({ entry: { photo: foreign }, port });

      expect(inputs.picture).toBe(foreign);
      expect(tryRead).not.toHaveBeenCalled();
    });

    /** @scenario "A plain web address in an image column is left as it is" */
    it("leaves an ordinary https address for the engine to fetch", async () => {
      const { port, tryRead } = storeHolding({});

      const inputs = await inline({ entry: { photo: "https://example.com/cat.png" }, port });

      expect(inputs.picture).toBe("https://example.com/cat.png");
      expect(tryRead).not.toHaveBeenCalled();
    });

    /** @scenario "A reference in a text column is left as text" */
    it("leaves a reference typed into a text column as the text it is", async () => {
      const { port, tryRead } = storeHolding({
        obj_1: { bytes: Buffer.from("PNGBYTES"), mediaType: "image/png" },
      });
      const reference = `/api/files/${PROJECT}/obj_1`;

      const inputs = await inline({ entry: { question: reference }, port });

      expect(inputs.question).toBe(reference);
      expect(tryRead).not.toHaveBeenCalled();
    });

    /** @scenario "A reference whose bytes the deployment no longer holds is left as text" */
    it("leaves a reference the object store cannot find as the text it is", async () => {
      const { port } = storeHolding({});
      const reference = `/api/files/${PROJECT}/gone`;

      const inputs = await inline({ entry: { photo: reference }, port });

      expect(inputs.picture).toBe(reference);
    });
  });
});

describe("given a deployment that composed no object store", () => {
  describe("when the run builds the target's inputs", () => {
    /** @scenario "A deployment with no object store leaves every reference as text" */
    it("leaves the reference as the text it is and keeps running", async () => {
      const reference = `/api/files/${PROJECT}/obj_1`;

      const inputs = await inline({
        entry: { photo: reference },
        port: UnavailableExperimentAttachmentAdapter.create(),
      });

      expect(inputs.picture).toBe(reference);
    });
  });
});

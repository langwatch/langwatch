import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TreeNode } from "../../../lib/syntax-tree.ts";
import { rehypeDocsMedia } from "../compile/rehype-content.ts";

function png({ width, height }: { width: number; height: number }) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jsxImage({ attributes }: { attributes: Record<string, string> }): TreeNode {
  return {
    type: "mdxJsxFlowElement",
    name: "img",
    attributes: Object.entries(attributes).map(([name, value]) => ({
      type: "mdxJsxAttribute",
      name,
      value,
    })),
  };
}

function attributesOf({ node }: { node: TreeNode }) {
  return Object.fromEntries((node.attributes ?? []).map(({ name, value }) => [name, value]));
}

let docsRoot = "";

beforeAll(async () => {
  docsRoot = await mkdtemp(path.join(tmpdir(), "docs-image-size-"));
  await mkdir(path.join(docsRoot, "images"));
  await writeFile(path.join(docsRoot, "images/wide.png"), png({ width: 1600, height: 900 }));
  await writeFile(
    path.join(docsRoot, "images/pointer.png"),
    "version https://git-lfs.github.com/spec/v1\noid sha256:0\nsize 1\n",
  );
});

afterAll(async () => {
  await rm(docsRoot, { recursive: true, force: true });
});

describe("rehypeDocsMedia", () => {
  describe("when a docs image has no authored size", () => {
    /** @scenario "Reserve space for authored images" */
    it("declares its intrinsic width and height", () => {
      const markdown: TreeNode = {
        type: "element",
        tagName: "img",
        properties: { src: "/images/wide.png" },
      };
      const jsx = jsxImage({ attributes: { src: "/images/wide.png", alt: "Wide" } });
      rehypeDocsMedia({ docsRoot })({ type: "root", children: [markdown, jsx] });
      expect(markdown.properties).toMatchObject({ width: 1600, height: 900 });
      expect(attributesOf({ node: jsx })).toMatchObject({ width: "1600", height: "900" });
      expect(jsx.name).toBe("DocsImg");
    });
  });

  describe("when the author set a pixel width", () => {
    /** @scenario "Reserve space for authored images" */
    it("keeps that width and scales the height to match", () => {
      const jsx = jsxImage({ attributes: { src: "/images/wide.png", width: "400" } });
      rehypeDocsMedia({ docsRoot })({ type: "root", children: [jsx] });
      expect(attributesOf({ node: jsx })).toMatchObject({ width: "400", height: "225" });
    });
  });

  describe("when the size cannot or should not be inferred", () => {
    /** @scenario "Reserve space for authored images" */
    it("leaves percentage widths, external images and LFS pointers alone", () => {
      const percent = jsxImage({ attributes: { src: "/images/wide.png", width: "50%" } });
      const external = jsxImage({ attributes: { src: "https://example.com/a.png" } });
      const pointer = jsxImage({ attributes: { src: "/images/pointer.png" } });
      rehypeDocsMedia({ docsRoot })({ type: "root", children: [percent, external, pointer] });
      expect(attributesOf({ node: percent })).toEqual({ src: "/images/wide.png", width: "50%" });
      expect(attributesOf({ node: external })).toEqual({ src: "https://example.com/a.png" });
      expect(attributesOf({ node: pointer })).toEqual({ src: "/images/pointer.png" });
    });
  });
});

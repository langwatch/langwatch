/**
 * Images into the draft: each picked, pasted or dropped image gets its chip at the caret and a
 * thumbnail, then uploads to its signed URL and is confirmed (ADR-158). A file Langy cannot take
 * shows as a failed thumbnail with no chip. Spec: specs/langy-image-attachments.feature
 */
import {
  LANGY_ATTACHMENT_MAX_COUNT,
  type LangyAttachment,
  LangyAttachmentRefusedError,
  type LangyAttachmentUpload,
  langyAttachmentVerdictOf,
} from "@langwatch/langy-contract";
import type React from "react";

import { describeError } from "../../../behavior/errors.tsx";
import { api } from "../../../behavior/langy-api.ts";
import { useLangyStore } from "../../../behavior/langy.store.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import {
  insertMarkers,
  markerLabelFor,
  pastedNameFor,
  randomHex,
} from "../model/langy-image-markers.ts";
import { useLangyComposerImages } from "./langy-composer-images.store.ts";

type UploadImage = (file: File) => Promise<LangyAttachment>;

/** PUTs the bytes to the signed URL, then confirms the stored object. */
async function uploadThrough({
  file,
  start,
  confirm,
}: {
  file: File;
  start: () => Promise<LangyAttachmentUpload>;
  confirm: (objectId: string) => Promise<LangyAttachment>;
}): Promise<LangyAttachment> {
  const upload = await start();
  const response = await fetch(upload.uploadUrl, {
    method: upload.method,
    headers: { "content-type": file.type, ...upload.headers },
    body: file,
  });
  if (!response.ok) throw new Error(`The image upload answered ${response.status}`);
  return confirm(upload.objectId);
}

function previewOf(file: File): string | undefined {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : undefined;
}

/** The file under the name its chip shows: a pasted image with no name of its own gets one. */
function namedFile(original: File): File {
  const fileName = pastedNameFor({ fileName: original.name, mediaType: original.type, randomHex });
  return fileName === original.name
    ? original
    : new File([original], fileName, { type: original.type });
}

async function uploadInto({
  key,
  file,
  uploadImage,
}: {
  key: string;
  file: File;
  uploadImage: UploadImage;
}): Promise<void> {
  const images = useLangyComposerImages.getState();
  try {
    images.update(key, { status: "ready", attachment: await uploadImage(file) });
  } catch (error) {
    images.update(key, {
      status: "failed",
      error: describeError({ error, fallbackTitle: "The image didn't upload" }),
      retry: () => {
        useLangyComposerImages
          .getState()
          .update(key, { status: "uploading", error: undefined, retry: undefined });
        void uploadInto({ key, file, uploadImage });
      },
    });
  }
}

/** Adds each file to the draft's images and starts its upload; answers the new chips' text. */
function addImages({
  files,
  uploadImage,
}: {
  files: readonly File[];
  uploadImage: UploadImage;
}): string[] {
  const store = useLangyComposerImages.getState();
  let accepted = store.images.filter((image) => image.status !== "failed").length;
  const labels: string[] = [];
  const taken = store.images.map((image) => image.label);
  for (const original of files) {
    const file = namedFile(original);
    const key = `image-${randomHex()}${randomHex()}`;
    const verdict = langyAttachmentVerdictOf({ mediaType: file.type, byteLength: file.size });
    const refusal =
      verdict === "accepted" && accepted >= LANGY_ATTACHMENT_MAX_COUNT ? "too_many" : verdict;
    const base = { key, fileName: file.name, mediaType: file.type };
    if (refusal !== "accepted") {
      const error = describeError({ error: new LangyAttachmentRefusedError(refusal) });
      store.add({ ...base, label: "", status: "failed", error });
      continue;
    }
    accepted += 1;
    const label = markerLabelFor({ fileName: file.name, taken: [...taken, ...labels] });
    labels.push(label);
    store.add({ ...base, label, previewUrl: previewOf(file), status: "uploading" });
    void uploadInto({ key, file, uploadImage });
  }
  return labels;
}

/** Stores one image of the current project through a signed upload. */
export function useLangyImageUpload(): UploadImage {
  const { project } = useOrganizationTeamProject();
  const { client } = api.useUtils();
  const projectId = project?.id;

  return (file) => {
    if (!projectId) return Promise.reject(new Error("No project to upload the image to"));
    return uploadThrough({
      file,
      start: () =>
        client.langy.createAttachmentUpload.mutate({
          projectId,
          filename: file.name,
          mediaType: file.type,
          byteLength: file.size,
        }),
      confirm: (objectId) => client.langy.confirmAttachmentUpload.mutate({ projectId, objectId }),
    });
  };
}

/** Puts files into the draft and uploads them; answers nothing when images can't be stored. */
export function useLangyImageAttach({
  textareaRef,
  uploadImage,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  uploadImage?: UploadImage;
}): ((files: readonly File[]) => void) | undefined {
  if (!uploadImage) return undefined;
  return (files) => {
    const labels = addImages({ files, uploadImage });
    if (labels.length === 0) return;
    const field = textareaRef.current;
    const draft = useLangyStore.getState().draft;
    const start = field?.selectionStart ?? draft.length;
    const end = field?.selectionEnd ?? draft.length;
    const next = insertMarkers({ text: draft, start, end, labels });
    useLangyStore.getState().setDraft(next.text);
    requestAnimationFrame(() => {
      const box = textareaRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(next.caret, next.caret);
    });
  };
}

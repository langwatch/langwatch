import {
  Button,
  ConfirmButton,
  Inline,
  KeyValue,
  Panel,
  Stack,
} from "@langwatch/design-system-internal";
import { SimCode, SimEmpty, SimRefusal, SimTime, useSimPoll } from "@langwatch/sim-console";
import { useEffect, useState } from "react";

import { formatSize, previewKind } from "./format.ts";
import { storageApi, type StoredObject } from "./storage-api.ts";

const PREVIEW_LIMIT = 64 * 1024;

const useTextPreview = ({ object, enabled }: { object: StoredObject; enabled: boolean }) => {
  const [text, setText] = useState<string | undefined>(undefined);
  useEffect(() => {
    setText(undefined);
    if (!enabled) return;
    let current = true;
    fetch(storageApi.rawPath(object))
      .then((response) => response.text())
      .then((body) => current && setText(body.slice(0, PREVIEW_LIMIT)))
      .catch(() => current && setText(undefined));
    return () => {
      current = false;
    };
  }, [object, enabled]);
  return text;
};

const Preview = ({ object }: { object: StoredObject }) => {
  const kind = previewKind({ contentType: object.contentType });
  const text = useTextPreview({ object, enabled: kind === "text" });
  if (kind === "image")
    return <img className="storage-preview" alt={object.key} src={storageApi.rawPath(object)} />;
  if (kind === "text")
    return text === undefined ? <SimEmpty title="Loading preview" /> : <SimCode text={text} />;
  return (
    <SimEmpty
      title="No preview"
      hint={`${object.contentType} cannot be shown here. Download it instead.`}
    />
  );
};

/** Mints a presigned GET for the object on demand, as the product's SDK would. */
const usePresigned = ({ object }: { object: StoredObject }) => {
  const [url, setUrl] = useState("");
  const [refusal, setRefusal] = useState("");
  useEffect(() => {
    setUrl("");
    setRefusal("");
  }, [object]);
  const mint = () => {
    storageApi
      .presign(object)
      .then((answer) => setUrl(answer.url))
      .catch((caught: unknown) => setRefusal(caught instanceof Error ? caught.message : "Refused"));
  };
  return { url, refusal, mint };
};

export const ObjectDetail = ({
  object,
  onDelete,
}: {
  object: StoredObject;
  onDelete: () => void;
}) => {
  const { data, error } = useSimPoll({ fetch: () => storageApi.detail(object), everyMs: 5_000 });
  const presigned = usePresigned({ object });
  const headers = Object.entries(data?.headers ?? {}).toSorted(([a], [b]) => a.localeCompare(b));
  return (
    <Stack gap={4}>
      <Panel
        title={object.key}
        actions={
          <Inline gap={2}>
            <Button size="sm" onClick={presigned.mint}>
              Presign GET
            </Button>
            <Button size="sm" href={storageApi.rawPath({ ...object, download: true })}>
              Download
            </Button>
            <ConfirmButton
              size="sm"
              label="Delete"
              confirmLabel="Delete object"
              onConfirm={onDelete}
            />
          </Inline>
        }
      >
        <KeyValue
          items={[
            { label: "Bucket", value: object.bucket },
            { label: "Key", value: object.key },
            { label: "Size", value: formatSize({ bytes: object.size }), copy: false },
            { label: "Content type", value: object.contentType },
            { label: "ETag", value: object.etag },
            { label: "Modified", value: <SimTime at={object.lastModified} />, mono: false },
          ]}
        />
      </Panel>
      {error ? <SimRefusal message={error.message} /> : null}
      {presigned.refusal === "" ? null : <SimRefusal message={presigned.refusal} />}
      {presigned.url === "" ? null : (
        <Panel title="Presigned GET" meta="valid for an hour">
          <KeyValue items={[{ label: "URL", value: presigned.url }]} />
        </Panel>
      )}
      <Panel title="Preview">
        <Preview object={object} />
      </Panel>
      <Panel title="Headers" meta={String(headers.length)}>
        <KeyValue items={headers.map(([label, value]) => ({ label, value }))} />
      </Panel>
    </Stack>
  );
};

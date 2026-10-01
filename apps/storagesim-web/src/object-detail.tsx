import { SimCode, SimEmpty, SimRefusal, useSimPoll } from "@langwatch/sim-console";
import { useEffect, useState } from "react";

import { previewKind } from "./format.ts";
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
    return <img alt={object.key} src={storageApi.rawPath(object)} style={{ maxWidth: "100%" }} />;
  if (kind === "text") return text === undefined ? null : <SimCode text={text} language="text" />;
  return (
    <SimEmpty
      title="No preview"
      hint={`${object.contentType} cannot be shown here. Download it instead.`}
    />
  );
};

export const ObjectDetail = ({ object }: { object: StoredObject }) => {
  const { data, error } = useSimPoll({ fetch: () => storageApi.detail(object), everyMs: 5_000 });
  return (
    <section aria-label={`Object ${object.key}`}>
      <h2>{object.key}</h2>
      <a href={storageApi.rawPath({ ...object, download: true })}>Download</a>
      {error ? <SimRefusal message={error.message} /> : null}
      <h3>Headers</h3>
      <dl>
        {Object.entries(data?.headers ?? {}).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>Preview</h3>
      <Preview object={object} />
    </section>
  );
};

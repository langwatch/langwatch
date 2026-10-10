/** A reference: `/api/files/:projectId/:id[/:name]`, or the legacy `/api/files/:id`. */
export type StoredObjectReference = {
  projectId: string | undefined;
  storedObjectId: string;
  filename: string | undefined;
};

const FILES_PREFIX = "/api/files/";

export function parseStoredObjectReference(reference: string): StoredObjectReference | null {
  if (!reference.startsWith(FILES_PREFIX)) return null;
  const [path = "", query = ""] = reference.slice(FILES_PREFIX.length).split(/[?#]/);
  const [first, second, third] = path.split("/");
  if (!first) return null;
  const named = third ?? new URLSearchParams(query).get("filename");
  const filename = named ? decodeURIComponent(named) : undefined;
  return second
    ? { projectId: first, storedObjectId: second, filename }
    : { projectId: undefined, storedObjectId: first, filename };
}

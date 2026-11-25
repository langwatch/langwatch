import { ExternalImage } from "@langwatch/design-system/external-image";
import type { ComponentProps } from "react";

import { useStoredObjectUrl } from "../../../behavior/stored-object/use-stored-object-url.ts";
import { parseStoredObjectReference } from "../../../model/stored-object/parse-stored-object-reference.ts";

type StoredObjectImageProps = ComponentProps<typeof ExternalImage> & { projectId?: string };

/** Nothing while the URL mints; a failed mint hands the reference on, showing the broken state. */
function MintedImage({ src, projectId, ...props }: StoredObjectImageProps) {
  const resolved = useStoredObjectUrl({ reference: src, projectId });
  if (resolved.status === "pending") return null;
  return <ExternalImage {...props} src={resolved.status === "ready" ? resolved.url : src} />;
}

/** `ExternalImage` for a value that may be a stored-object reference. */
export function StoredObjectImage({ projectId, ...props }: StoredObjectImageProps) {
  if (!parseStoredObjectReference(props.src)) return <ExternalImage {...props} />;
  return <MintedImage {...props} projectId={projectId} />;
}

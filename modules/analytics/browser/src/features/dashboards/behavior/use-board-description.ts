/**
 * SEAM: a board's description. `Dashboard` has no description field and no
 * procedure takes one, so this keeps it for the visit only. Once the server
 * carries it, read and write it here; callers keep this shape.
 */

import { useState } from "react";

export function useBoardDescription() {
  const [description, setDescription] = useState("");
  return {
    description,
    saveDescription: (next: string) => setDescription(next.trim()),
  };
}

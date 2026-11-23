// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The reason a person gives for a stop: required, trimmed, and kept until the dialog closes. */
import { useState } from "react";

export function useStopReason() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return {
    value,
    error,
    change: (next: string) => {
      setValue(next);
      setError(null);
    },
    /** The trimmed reason, or null after saying why it is needed. */
    take: (): string | null => {
      const trimmed = value.trim();
      if (!trimmed) setError("Say why you are stopping this agent.");
      return trimmed || null;
    },
    clear: () => {
      setValue("");
      setError(null);
    },
  };
}

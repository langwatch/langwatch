import { useCallback, useState } from "react";
import type { z } from "zod";

import { request, type Refusal } from "./api.ts";

/**
 * One panel's acts: which one is running, and the refusal the last one came
 * back with, shown beside the form that caused it. `onDone` re-reads the page.
 */
export const useAct = ({ onDone }: { onDone: () => void }) => {
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);

  const act = useCallback(
    async <Data>({
      name,
      path,
      method,
      body,
      schema,
    }: {
      name: string;
      path: string;
      method: "POST" | "PUT" | "DELETE";
      body?: unknown;
      schema: z.ZodType<Data>;
    }): Promise<Data | undefined> => {
      setBusy(name);
      const answer = await request({ path, method, body, schema });
      setBusy(undefined);
      if (!answer.ok) {
        setRefusal(answer.refusal);
        return undefined;
      }
      setRefusal(undefined);
      onDone();
      return answer.data;
    },
    [onDone],
  );

  return { act, busy, refusal };
};

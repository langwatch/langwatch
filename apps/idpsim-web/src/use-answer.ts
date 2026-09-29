import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";

import { request, type Refusal } from "./api.ts";

/** A GET the page renders from, re-read after every act that changes it. */
export const useAnswer = <Data>({ path, schema }: { path: string; schema: z.ZodType<Data> }) => {
  const [data, setData] = useState<Data | undefined>(undefined);
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void request({ path, schema, signal: controller.signal }).then((answer) => {
      if (controller.signal.aborted) return;
      if (answer.ok) {
        setData(answer.data);
        setRefusal(undefined);
      } else {
        setRefusal(answer.refusal);
      }
    });
    return () => controller.abort();
  }, [path, schema, generation]);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  return { data, refusal, reload };
};

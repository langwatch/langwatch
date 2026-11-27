import { useCallback, useEffect, useRef, useState } from "react";

import {
  EMPTY_CONNECTOR_FORM,
  formFromAgent,
  type ConnectorForm,
} from "../model/connector-form.ts";

type SavedAgent = { name?: string | null; config?: unknown };

/** Form fields, seeded once per drawer session: the saved agent, or the starters when new. */
export function useConnectorFormState(input: {
  agent: SavedAgent | null | undefined;
  agentId: string | undefined;
  isOpen: boolean;
}) {
  const { agent, agentId, isOpen } = input;
  const [form, setForm] = useState<ConnectorForm>(EMPTY_CONNECTOR_FORM);
  const seededFor = useRef<string | undefined>(void 0);
  const identity = agentId ?? "new";

  useEffect(() => {
    if (!isOpen) {
      seededFor.current = void 0;
      return;
    }
    if (seededFor.current === identity) return;
    if (agentId && !agent) return;
    setForm(agent ? formFromAgent(agent) : EMPTY_CONNECTOR_FORM);
    seededFor.current = identity;
  }, [agent, agentId, identity, isOpen]);

  const change = useCallback((values: Partial<ConnectorForm>) => {
    setForm((previous) => ({ ...previous, ...values }));
  }, []);

  return { form, change };
}

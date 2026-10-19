import type { Monaco } from "@monaco-editor/react";

import { registerCodeActions } from "./python-provider.code-actions.ts";
import { registerCompletion } from "./python-provider.completion.ts";
import { registerFormatter } from "./python-provider.formatter.ts";
import { registerHover } from "./python-provider.hover.ts";
import type {
  ContractRef,
  PythonContract,
  PythonProviderHandle,
} from "./python-provider.shared.ts";
import { registerSignatureHelp } from "./python-provider.signature-help.ts";
import { registerValidator } from "./python-provider.validator.ts";

export interface RegisterPythonProvidersOptions {
  monaco: Monaco;
  contract: PythonContract;
}

/** Register Monaco providers for Python editor; returns disposable handle for cleanup. */
export function registerPythonProviders({
  monaco,
  contract,
}: RegisterPythonProvidersOptions): PythonProviderHandle {
  const contractRef: ContractRef = { current: contract };
  const completionDisposer = registerCompletion(monaco, contractRef);
  const hoverDisposer = registerHover(monaco, contractRef);
  const formatterDisposer = registerFormatter(monaco);
  const validatorDisposer = registerValidator(monaco, contractRef);
  const codeActionsDisposer = registerCodeActions(monaco, contractRef);
  const signatureHelpDisposer = registerSignatureHelp(monaco);

  return {
    dispose: () => {
      completionDisposer.dispose();
      hoverDisposer.dispose();
      formatterDisposer.dispose();
      validatorDisposer.dispose();
      codeActionsDisposer.dispose();
      signatureHelpDisposer.dispose();
    },
    setContract: (next) => {
      contractRef.current = next;
      // Re-run validation directly so contract changes update markers
      // immediately — including on empty buffers, where the previous
      // applyEdits no-op trick fired no change event.
      validatorDisposer.revalidate();
    },
  };
}

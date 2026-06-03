import type { Monaco } from "@monaco-editor/react";
import { registerCodeActions } from "./python/codeActions";
import { registerCompletion } from "./python/completion";
import { registerFormatter } from "./python/formatter";
import { registerHover } from "./python/hover";
import type {
  ContractRef,
  PythonContract,
  PythonProviderHandle,
} from "./python/shared";
import { registerSignatureHelp } from "./python/signatureHelp";
import { registerValidator } from "./python/validator";

export interface RegisterPythonProvidersOptions {
  monaco: Monaco;
  contract: PythonContract;
}

/**
 * Register all Monaco providers used by the workflow Python editor. Returns
 * a single handle whose `dispose()` tears everything down — call it on
 * editor unmount to avoid leaking globally-registered providers across
 * remounts.
 *
 * Each provider lives in its own module under `./python/` — see `shared.ts`
 * for the common types, regexes, marker codes, and helpers they all draw on.
 */
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

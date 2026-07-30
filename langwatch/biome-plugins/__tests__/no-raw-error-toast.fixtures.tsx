/**
 * Deliberate violations of `../no-raw-error-toast.grit`. Every function below
 * is a leak the plugin claims to catch, and every one of them MUST be flagged.
 *
 * This file exists because a lint gate can only fail if the rule still
 * matches. A GritQL pattern that drifts — a renamed node kind, a field that
 * stopped existing, a regex that no longer anchors — compiles fine, matches
 * nothing, and reports "No fixes applied" against the whole repo forever. The
 * `Enforce analyzer plugins` step in .github/workflows/langwatch-app-ci.yml
 * then passes for the same reason a broken smoke detector is silent. This is
 * the plugin's answer to the scanner's `SCANNED_FILE_FLOOR`: run the plugin
 * over known violations and require a NON-ZERO exit before trusting the zero
 * it reports on real code.
 *
 * Not compiled and not linted: it sits outside `src/` and `ee/`, which is the
 * scope of `pnpm lint`, of the CI gate, and of the companion scanner's walk;
 * `__tests__/` is excluded from tsconfig.tsgo.json, and tsconfig.tsgo.tests.json
 * only reaches into `src/`, `ee/`, `scripts/` and `e2e/`. Keep it there — the
 * moment it lands under `src/` it fails the gate it defends.
 *
 * Adding a pattern to the plugin? Add its violation here and raise the floor
 * in the workflow.
 */

declare const toaster: {
  create: (props: unknown) => void;
  error: (props: unknown) => void;
  update: (id: string, props: unknown) => void;
};
declare const showErrorToast: (props: unknown) => void;
declare const form: { setError: (name: string, props: unknown) => void };
declare const fmt: (...parts: unknown[]) => string;
declare const HandledErrorAlert: (props: unknown) => JSX.Element;
declare const ErrorCard: (props: { title?: unknown; children?: unknown }) => JSX.Element;
declare const Toast: { Description: (props: unknown) => JSX.Element };
declare const Alert: {
  Title: (props: unknown) => JSX.Element;
  Description: (props: unknown) => JSX.Element;
};

/* -- object-literal copy slots ------------------------------------------- */

export function flatDescription(error: Error) {
  toaster.create({ description: error.message, type: "error" });
}

export function titleSlot(error: Error) {
  toaster.create({ title: error.message, type: "error" });
}

export function optionalChain(err: Error | undefined) {
  toaster.create({ description: err?.message });
}

export function behindACast(error: unknown) {
  toaster.create({ description: (error as Error).message });
}

export function insideATemplate(error: Error) {
  toaster.create({ description: `Couldn't save: ${error.message}` });
}

export function insideACall(error: Error) {
  toaster.create({ description: fmt("Couldn't save", error.message) });
}

/* -- the other stringifiers ---------------------------------------------- */

export function stringified(err: Error) {
  toaster.create({ description: String(err) });
}

export function jsonStringified(err: Error) {
  toaster.create({ description: JSON.stringify(err) });
}

export function viaToString(err: Error) {
  toaster.create({ description: err.toString() });
}

/* -- the toaster surface beyond `.create` -------------------------------- */

export function statusShorthand(error: Error) {
  toaster.error({ description: error.message });
}

export function updateCall(error: Error) {
  toaster.update("id", { description: error.message });
}

export function showErrorToastFallback(error: Error) {
  showErrorToast({ error, fallbackTitle: error.message });
}

/* -- the form bridge ------------------------------------------------------ */

export function formServerError(error: Error) {
  form.setError("root.serverError", { message: error.message });
}

/* -- JSX attributes ------------------------------------------------------- */

export function selfClosingAttribute(error: Error) {
  return <HandledErrorAlert error={error} fallbackTitle={error.message} />;
}

export function openingTagAttribute(error: Error) {
  return <ErrorCard title={error.message}>details</ErrorCard>;
}

/* -- JSX children --------------------------------------------------------- */

export function toastChild(error: Error) {
  return <Toast.Description>{error.message}</Toast.Description>;
}

export function alertDescriptionChild(error: Error) {
  return <Alert.Description>{error.message}</Alert.Description>;
}

export function alertTitleChild(error: Error) {
  return <Alert.Title>{`Couldn't save: ${error.message}`}</Alert.Title>;
}

/* -- suppression: these two must NOT be flagged --------------------------- */

export function markedInsideTheCall(error: Error) {
  toaster.create({
    // no-raw-error-toast-ok
    description: error.message,
  });
}

export function markedWithBiomeIgnore(error: Error) {
  // biome-ignore lint: fixture for the plugin's own suppression path
  toaster.create({ description: error.message });
}

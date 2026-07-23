/**
 * The form bridge's job is to put a rejected submission back where the user is
 * looking. Its subtler job is knowing when NOT to — a validation error about
 * something this form doesn't own must fall through to a toast rather than
 * being silently absorbed, which would leave the user staring at a form that
 * looks fine and a save that didn't happen.
 */
import { describe, expect, it, vi } from "vitest";

import { applyHandledErrorToForm } from "../applyHandledErrorToForm";

type FormStub = {
  control: { _fields: Record<string, unknown> };
  setError: ReturnType<typeof vi.fn>;
};

/**
 * What react-hook-form records for a field an input registered AND mounted:
 * a `_f` descriptor holding the live ref. That ref is the whole signal — it is
 * the difference between a key the form knows about and a key the user can
 * see.
 */
const registered = (name: string) => ({ _f: { name, ref: {} } });

const formWithFields = (...fields: string[]): FormStub => ({
  control: {
    _fields: Object.fromEntries(
      fields.map((field) => [field, registered(field)]),
    ),
  },
  setError: vi.fn(),
});

const validationError = (meta: Record<string, unknown>) => ({
  data: { error: { code: "validation_error", httpStatus: 422, meta } },
});

// The bridge only touches `control._fields` and `setError`; the rest of
// UseFormReturn is irrelevant to it.
const apply = (error: unknown, form: FormStub, hasFormErrorSlot = false) =>
  applyHandledErrorToForm({ error, form: form as never, hasFormErrorSlot });

describe("applyHandledErrorToForm", () => {
  describe("given a validation error naming fields the form owns", () => {
    it("marks each field with its message", () => {
      const form = formWithFields("name", "slug");

      const isConsumed = apply(
        validationError({
          fieldErrors: { name: ["Required"], slug: ["Already taken"] },
        }),
        form,
      );

      expect(isConsumed).toBe(true);
      expect(form.setError).toHaveBeenCalledWith(
        "name",
        { type: "server", message: "Required" },
        { shouldFocus: true },
      );
      expect(form.setError).toHaveBeenCalledWith(
        "slug",
        { type: "server", message: "Already taken" },
        { shouldFocus: false },
      );
    });

    it("focuses only the first, so the page doesn't fight itself", () => {
      const form = formWithFields("a", "b", "c");

      apply(
        validationError({
          fieldErrors: { a: ["x"], b: ["y"], c: ["z"] },
        }),
        form,
      );

      const focused = form.setError.mock.calls.filter(
        (call) => call[2]?.shouldFocus,
      );
      expect(focused).toHaveLength(1);
    });
  });

  describe("given form-level errors and a form that renders the root slot", () => {
    it("puts them on the form root and claims the error", () => {
      const form = formWithFields("name");

      const isConsumed = apply(
        validationError({ formErrors: ["Pick at least one channel."] }),
        form,
        true,
      );

      expect(isConsumed).toBe(true);
      expect(form.setError).toHaveBeenCalledWith("root.serverError", {
        type: "server",
        message: "Pick at least one channel.",
      });
    });
  });

  describe("given form-level errors and a form with no root slot", () => {
    /**
     * The failure this protects against is silence, which is worse than the
     * raw-message toast the module replaced: `setError("root.serverError")`
     * succeeds whether or not anything renders it, so claiming the error
     * suppressed the caller's toast and the user got no feedback at all from
     * pressing Save. Every call site was in this state until now.
     */
    it("declines it so the caller still reports the failure", () => {
      const form = formWithFields("name");

      const isConsumed = apply(
        validationError({ formErrors: ["Pick at least one channel."] }),
        form,
      );

      expect(isConsumed).toBe(false);
      expect(form.setError).not.toHaveBeenCalled();
    });

    it("still marks the fields it can show, so the form isn't left clean", () => {
      const form = formWithFields("name");

      const isConsumed = apply(
        validationError({
          fieldErrors: { name: ["Required"] },
          formErrors: ["Pick at least one channel."],
        }),
        form,
      );

      expect(form.setError).toHaveBeenCalledWith(
        "name",
        { type: "server", message: "Required" },
        // No focus grab: a toast is coming for the part this form can't show,
        // and pulling focus into a field while it explains something else
        // reads as two things competing.
        { shouldFocus: false },
      );
      // Partial: the form-level complaint has nowhere to go, so the toast
      // must still fire.
      expect(isConsumed).toBe(false);
    });
  });

  describe("given a nested field the form only owns as a container", () => {
    it("declines it — setting an error on a container shows the user nothing", () => {
      // zod's flatten() collapses ["version","configData","prompt"] to
      // "version", which the form owns only as a branch: the input is
      // registered three levels down. Marking the branch would leave a
      // clean-looking form and a save that silently didn't happen.
      const form: FormStub = {
        control: {
          _fields: {
            version: {
              configData: { prompt: registered("version.configData.prompt") },
            },
          },
        },
        setError: vi.fn(),
      };

      const isConsumed = apply(
        validationError({ fieldErrors: { version: ["Required"] } }),
        form,
      );

      expect(isConsumed).toBe(false);
      expect(form.setError).not.toHaveBeenCalled();
    });
  });

  describe("given a key the form holds a value for but paints no input for", () => {
    /**
     * The bug this replaced. `getValues()` answers "is there a value under
     * this key", which is true for every hidden default a form carries —
     * `projectId`, `organizationId`, an id threaded through for the mutation.
     * The bridge would claim the error, set it on a key nothing renders, and
     * return `true`, suppressing the caller's toast: the user pressed Save and
     * absolutely nothing happened. One call site had already worked around it
     * by hand.
     */
    it("declines it, so the failure still reaches the user as a toast", () => {
      const form: FormStub = {
        control: { _fields: { name: registered("name") } },
        setError: vi.fn(),
      };

      const isConsumed = apply(
        validationError({ fieldErrors: { projectId: ["Required"] } }),
        form,
      );

      expect(isConsumed).toBe(false);
      expect(form.setError).not.toHaveBeenCalled();
    });
  });

  describe("given a field whose value is an array", () => {
    /**
     * Ownership follows registration, not the shape of the value. A
     * multi-select is one input holding a list, and it renders its own error
     * perfectly well — the previous check declined it purely for being an
     * object, which sent a complaint the form could show to a toast instead.
     */
    it("claims a multi-select, which is one input holding a list", () => {
      const form = formWithFields("channels");

      const isConsumed = apply(
        validationError({ fieldErrors: { channels: ["Pick at least one"] } }),
        form,
      );

      expect(isConsumed).toBe(true);
      expect(form.setError).toHaveBeenCalledWith(
        "channels",
        { type: "server", message: "Pick at least one" },
        { shouldFocus: true },
      );
    });

    it("declines a field array, whose inputs live on its items", () => {
      // `useFieldArray("recipients")` registers `recipients.0.email`, so the
      // array itself has no input of its own to hang the message on.
      const form: FormStub = {
        control: {
          _fields: {
            recipients: [{ email: registered("recipients.0.email") }],
          },
        },
        setError: vi.fn(),
      };

      const isConsumed = apply(
        validationError({ fieldErrors: { recipients: ["Required"] } }),
        form,
      );

      expect(isConsumed).toBe(false);
      expect(form.setError).not.toHaveBeenCalled();
    });
  });

  describe("given only some of the named fields on this form", () => {
    it("marks what it can but still declines, so the rest isn't lost", () => {
      const form = formWithFields("name");

      const isConsumed = apply(
        validationError({
          fieldErrors: { name: ["Required"], organizationId: ["Nope"] },
        }),
        form,
      );

      // `name` is marked so the user sees something, but the organizationId
      // complaint has nowhere to render — the caller must still toast.
      expect(form.setError).toHaveBeenCalledWith(
        "name",
        expect.objectContaining({ message: "Required" }),
        expect.anything(),
      );
      expect(isConsumed).toBe(false);
    });
  });

  describe("given a validation error about fields this form does not have", () => {
    it("declines it, so it falls through to a toast instead of vanishing", () => {
      const form = formWithFields("name");

      const isConsumed = apply(
        validationError({ fieldErrors: { somethingElse: ["Nope"] } }),
        form,
      );

      expect(isConsumed).toBe(false);
      expect(form.setError).not.toHaveBeenCalled();
    });
  });

  describe("given anything that is not a validation error", () => {
    it.each([
      [
        "a different handled code",
        {
          data: {
            error: { code: "trace_not_found", httpStatus: 404, meta: {} },
          },
        },
      ],
      ["an unhandled error", { data: { error: null } }],
      ["a bare Error", new Error("boom")],
      ["nothing at all", undefined],
    ])("declines %s", (_label, error) => {
      const form = formWithFields("name");

      expect(apply(error, form)).toBe(false);
      expect(form.setError).not.toHaveBeenCalled();
    });
  });

  describe("given a malformed validation payload", () => {
    it("declines rather than setting empty errors", () => {
      const form = formWithFields("name");

      expect(apply(validationError({}), form)).toBe(false);
      expect(apply(validationError({ fieldErrors: { name: [] } }), form)).toBe(
        false,
      );
      expect(
        apply(validationError({ fieldErrors: "not an object" }), form),
      ).toBe(false);
      expect(form.setError).not.toHaveBeenCalled();
    });
  });
});

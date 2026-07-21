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
  getValues: () => Record<string, unknown>;
  setError: ReturnType<typeof vi.fn>;
};

const formWithFields = (...fields: string[]): FormStub => ({
  getValues: () => Object.fromEntries(fields.map((field) => [field, ""])),
  setError: vi.fn(),
});

const validationError = (meta: Record<string, unknown>) => ({
  data: { error: { code: "validation_error", httpStatus: 422, meta } },
});

// The bridge only touches `getValues` and `setError`; the rest of
// UseFormReturn is irrelevant to it.
const apply = (error: unknown, form: FormStub) =>
  applyHandledErrorToForm({ error, form: form as never });

describe("applyHandledErrorToForm", () => {
  describe("given a validation error naming fields the form owns", () => {
    it("marks each field with its message", () => {
      const form = formWithFields("name", "slug");

      const consumed = apply(
        validationError({
          fieldErrors: { name: ["Required"], slug: ["Already taken"] },
        }),
        form,
      );

      expect(consumed).toBe(true);
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

  describe("given form-level errors", () => {
    it("puts them on the form root", () => {
      const form = formWithFields("name");

      const consumed = apply(
        validationError({ formErrors: ["Pick at least one channel."] }),
        form,
      );

      expect(consumed).toBe(true);
      expect(form.setError).toHaveBeenCalledWith("root.serverError", {
        type: "server",
        message: "Pick at least one channel.",
      });
    });
  });

  describe("given a nested field the form only owns as a container", () => {
    it("declines it — setting an error on a container shows the user nothing", () => {
      // zod's flatten() collapses ["version","configData","prompt"] to
      // "version", which the form owns as an object. No input is registered
      // against it, so marking it would leave a clean-looking form and a
      // save that silently didn't happen.
      const form: FormStub = {
        getValues: () => ({ version: { configData: { prompt: "" } } }),
        setError: vi.fn(),
      };

      const consumed = apply(
        validationError({ fieldErrors: { version: ["Required"] } }),
        form,
      );

      expect(consumed).toBe(false);
      expect(form.setError).not.toHaveBeenCalled();
    });
  });

  describe("given only some of the named fields on this form", () => {
    it("marks what it can but still declines, so the rest isn't lost", () => {
      const form = formWithFields("name");

      const consumed = apply(
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
      expect(consumed).toBe(false);
    });
  });

  describe("given a validation error about fields this form does not have", () => {
    it("declines it, so it falls through to a toast instead of vanishing", () => {
      const form = formWithFields("name");

      const consumed = apply(
        validationError({ fieldErrors: { somethingElse: ["Nope"] } }),
        form,
      );

      expect(consumed).toBe(false);
      expect(form.setError).not.toHaveBeenCalled();
    });
  });

  describe("given anything that is not a validation error", () => {
    it.each([
      ["a different handled code", { data: { error: { code: "trace_not_found", httpStatus: 404, meta: {} } } }],
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
      expect(
        apply(validationError({ fieldErrors: { name: [] } }), form),
      ).toBe(false);
      expect(
        apply(validationError({ fieldErrors: "not an object" }), form),
      ).toBe(false);
      expect(form.setError).not.toHaveBeenCalled();
    });
  });
});

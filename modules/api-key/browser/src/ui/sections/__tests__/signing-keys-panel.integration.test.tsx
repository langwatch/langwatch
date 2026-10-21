/**
 * @vitest-environment jsdom
 * The keys panel as the Braids page mounts it: loaded through `SigningKeysPanelToken`.
 * Spec: modules/api-key/specs/signing-keys.feature
 */

import { SigningKeysPanelToken, type SigningKeysPanelProps } from "@langwatch/api-key-client";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { apiKeyWeb } from "../../../api-key.web.ts";
import { FakeApiKeyHost, renderWithApiKeyHost } from "../../../testing.tsx";

vi.mock("shiki", () => {
  const highlighter = {
    codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
    getLoadedLanguages: () => ["typescript", "python", "go"],
    loadLanguage: () => Promise.resolve(),
  };
  return {
    bundledLanguagesInfo: [],
    createHighlighter: () => Promise.resolve(highlighter),
    getSingletonHighlighter: () => Promise.resolve(highlighter),
  };
});

const SECRET = "lwsk_pub0000000000001_s3cr3tS3cr3tS3cr3tS3cr3tS3cr3tS3cr3tAbCd";
const ENTERPRISE_REFUSAL = {
  data: {
    error: { code: "enterprise_plan_required", httpStatus: 403, meta: { feature: "BRAIDS" } },
  },
};

function key(overrides: Record<string, unknown>) {
  return {
    id: "key-1",
    name: "Production",
    publicId: "pub0000000000001",
    projectId: "proj-1",
    status: "active",
    createdAt: "2026-10-20T10:00:00.000Z",
    createdByUserId: "user-1",
    lastUsedAt: "2026-10-21T09:00:00.000Z",
    verifiesUntil: null,
    revokedAt: null,
    passed24h: 18204,
    failed24h: 3,
    ...overrides,
  };
}

const { state, calls } = vi.hoisted(() => ({
  state: {
    keys: [] as Record<string, unknown>[],
    refusal: undefined as unknown,
  },
  calls: {
    create: [] as unknown[],
    rotate: [] as unknown[],
    revoke: [] as unknown[],
    mutationOptions: [] as unknown[],
    listInputs: [] as unknown[],
  },
}));

function mutation(name: "create" | "rotate" | "revoke") {
  return {
    useMutation: (options?: unknown) => {
      calls.mutationOptions.push({ name, options });
      return {
        isPending: false,
        reset: () => undefined,
        mutate: (
          input: { name?: string; keyId?: string },
          handlers: { onSuccess: (answer: unknown) => void; onError: (error: unknown) => void },
        ) => {
          calls[name].push(input);
          if (state.refusal) return handlers.onError(state.refusal);
          if (name === "revoke") return handlers.onSuccess(key({ status: "revoked" }));
          handlers.onSuccess({
            signingKey: key({ id: "key-new", name: input.name ?? "Production" }),
            secret: SECRET,
          });
        },
      };
    },
  };
}

vi.mock("../../../behavior/api-key-api.ts", () => ({
  apiKeyApi: {
    useUtils: () => ({ signingKeys: { list: { invalidate: () => Promise.resolve() } } }),
    signingKeys: {
      list: {
        useQuery: (input: unknown) => {
          calls.listInputs.push(input);
          return { data: state.keys, isLoading: false };
        },
      },
      create: mutation("create"),
      rotate: mutation("rotate"),
      revoke: mutation("revoke"),
    },
  },
}));

let Panel: ComponentType<SigningKeysPanelProps>;

beforeAll(async () => {
  const lend = apiKeyWeb.installation.lends.find(
    ({ token }) => token.key === SigningKeysPanelToken.key,
  );
  const loaded = lend && "load" in lend ? await lend.load() : undefined;
  Panel = (loaded as { default: ComponentType<SigningKeysPanelProps> }).default;
});

beforeEach(() => {
  state.keys = [];
  state.refusal = undefined;
  for (const list of Object.values(calls)) list.length = 0;
});

afterEach(cleanup);

function renderPanel(host = new FakeApiKeyHost()) {
  return renderWithApiKeyHost(<Panel projectId="proj-1" />, host);
}

describe("given the Braids page mounts the signing keys panel by its token", () => {
  describe("when the project holds keys in each status", () => {
    /** @scenario Each key shows its status and its signed spans over the last 24 hours */
    it("shows each key's status, created, last used and passed and failed counts", () => {
      state.keys = [
        key({}),
        key({
          id: "key-2",
          name: "Staging",
          status: "verifying",
          verifiesUntil: "2026-10-28T10:00:00.000Z",
          lastUsedAt: null,
          passed24h: 0,
          failed24h: 0,
        }),
        key({ id: "key-3", name: "Old", status: "revoked", revokedAt: "2026-10-19T10:00:00.000Z" }),
      ];
      renderPanel();

      const active = within(screen.getByTestId("signing-key-row-key-1"));
      expect(active.getByText("Production")).toBeInTheDocument();
      expect(active.getByText("Active")).toBeInTheDocument();
      expect(active.getByText(`${(18204).toLocaleString()} passed`)).toBeInTheDocument();
      expect(active.getByText("3 failed")).toBeInTheDocument();

      const verifying = within(screen.getByTestId("signing-key-row-key-2"));
      expect(verifying.getByText(/Verifying until/)).toBeInTheDocument();
      expect(verifying.getByText("Not used yet")).toBeInTheDocument();

      expect(
        within(screen.getByTestId("signing-key-row-key-3")).getByText("Revoked"),
      ).toBeInTheDocument();
      expect(calls.listInputs).toContainEqual({ projectId: "proj-1" });
    });
  });

  describe("when an admin creates a key", () => {
    /** @scenario Creating a signing key shows its secret once */
    it("shows the secret once with TypeScript, Python and Go setup, then drops it", async () => {
      const user = userEvent.setup();
      const host = new FakeApiKeyHost();
      renderPanel(host);

      await user.click(screen.getByTestId("signing-key-new"));
      await user.type(screen.getByPlaceholderText("Production"), "Production");
      await user.click(screen.getByTestId("signing-key-create-confirm"));

      expect(calls.create).toEqual([{ projectId: "proj-1", name: "Production" }]);
      const dialog = within(await screen.findByTestId("signing-key-secret-dialog"));
      expect(dialog.getByText(/won't be able to see it again/)).toBeInTheDocument();
      expect(dialog.getByTestId("signing-key-secret")).not.toHaveTextContent(SECRET);
      expect(dialog.getByRole("tab", { name: "TypeScript" })).toBeInTheDocument();
      expect(dialog.getByRole("tab", { name: "Python" })).toBeInTheDocument();
      expect(dialog.getByRole("tab", { name: "Go" })).toBeInTheDocument();
      expect(await dialog.findAllByText(/withSignedBaggage/)).not.toHaveLength(0);
      await user.click(dialog.getByRole("tab", { name: "Python" }));
      expect(await dialog.findAllByText(/signed_baggage/)).not.toHaveLength(0);
      await user.click(dialog.getByRole("tab", { name: "Go" }));
      expect(await dialog.findAllByText(/SignBaggage/)).not.toHaveLength(0);

      await user.click(dialog.getByRole("button", { name: /Copy key/ }));
      expect(host.copies.map(({ text }) => text)).toEqual([SECRET]);

      await user.click(dialog.getByTestId("signing-key-secret-done"));
      await waitFor(() =>
        expect(screen.queryByTestId("signing-key-secret-dialog")).not.toBeInTheDocument(),
      );
      expect(document.body).not.toHaveTextContent(SECRET);
    });

    it("keeps no cache entry for the answers that carry a secret", () => {
      renderPanel();

      expect(calls.mutationOptions).toContainEqual({ name: "create", options: { gcTime: 0 } });
      expect(calls.mutationOptions).toContainEqual({ name: "rotate", options: { gcTime: 0 } });
    });
  });

  describe("when an admin rotates a key", () => {
    it("confirms the seven-day overlap, then shows the new secret once", async () => {
      const user = userEvent.setup();
      state.keys = [key({})];
      renderPanel();

      await user.click(screen.getByRole("button", { name: "Actions for Production" }));
      await user.click(await screen.findByRole("menuitem", { name: "Rotate" }));
      expect(await screen.findByText(/keeps verifying for 7 days/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Rotate key" }));

      expect(calls.rotate).toEqual([{ projectId: "proj-1", keyId: "key-1" }]);
      expect(await screen.findByText(`"Production" was rotated`)).toBeInTheDocument();
    });
  });

  describe("when an admin revokes a key", () => {
    it("confirms that it stops at once, then revokes it", async () => {
      const user = userEvent.setup();
      const host = new FakeApiKeyHost();
      state.keys = [key({})];
      renderPanel(host);

      await user.click(screen.getByRole("button", { name: "Actions for Production" }));
      await user.click(await screen.findByRole("menuitem", { name: "Revoke" }));
      expect(await screen.findByText(/stops working at once/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Revoke key" }));

      expect(calls.revoke).toEqual([{ projectId: "proj-1", keyId: "key-1" }]);
      expect(host.successes.map(({ title }) => title)).toEqual(["Signing key revoked"]);
    });
  });

  describe("when the organisation is below Enterprise", () => {
    it("shows the Enterprise upsell rather than a failure", async () => {
      const user = userEvent.setup();
      const host = new FakeApiKeyHost();
      state.refusal = ENTERPRISE_REFUSAL;
      renderPanel(host);

      await user.click(screen.getByTestId("signing-key-new"));
      await user.type(screen.getByPlaceholderText("Production"), "Production");
      await user.click(screen.getByTestId("signing-key-create-confirm"));

      expect(await screen.findByTestId("signing-keys-upsell")).toBeInTheDocument();
      expect(host.failures).toEqual([]);
    });

    it("reports any other refusal through the host", async () => {
      const user = userEvent.setup();
      const host = new FakeApiKeyHost();
      state.refusal = { data: { error: { code: "forbidden", httpStatus: 403 } } };
      renderPanel(host);

      await user.click(screen.getByTestId("signing-key-new"));
      await user.type(screen.getByPlaceholderText("Production"), "Production");
      await user.click(screen.getByTestId("signing-key-create-confirm"));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(screen.queryByTestId("signing-keys-upsell")).not.toBeInTheDocument();
    });
  });
});

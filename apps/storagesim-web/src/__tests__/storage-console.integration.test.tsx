// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StorageConsole } from "../storage-console.tsx";

const one = {
  bucket: "uploads",
  key: "a/one.txt",
  size: 5,
  contentType: "text/plain",
  etag: '"5d41402abc4b2a76b9719d911017c592"',
  lastModified: "2026-09-30T10:00:00Z",
};

const json = ({ body, status = 200 }: { body: unknown; status?: number }) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The sim's API as the console calls it; `stored` is what the bucket holds. */
const fakeSim = ({ stored }: { stored: (typeof one)[] }) => {
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input, "http://storage.test");
    if (url.pathname === "/_sim/api/buckets") {
      const size = stored.reduce((sum, object) => sum + object.size, 0);
      return json({
        body: { buckets: stored.length ? [{ name: "uploads", objects: stored.length, size }] : [] },
      });
    }
    if (url.pathname === "/_sim/api/objects") return json({ body: { objects: stored } });
    if (url.pathname === "/_sim/api/requests") return json({ body: { requests: [] } });
    if (url.pathname === "/_sim/api/object/raw") return new Response("hello");
    if (url.pathname === "/_sim/api/object") {
      return json({
        body: { ...one, headers: { "Content-Length": "5", "Content-Type": "text/plain" } },
      });
    }
    return json({ body: { error: "not_found" }, status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("the storagesim console", () => {
  beforeEach(() => {
    window.location.hash = "";
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists the buckets, and a bucket opens its objects", async () => {
    fakeSim({ stored: [one] });
    render(<StorageConsole />);

    fireEvent.click(await screen.findByText("uploads"));

    expect(await screen.findByText("a/one.txt")).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>("Bucket").value).toBe("uploads");
  });

  it("narrows the objects by a search on their key", async () => {
    fakeSim({ stored: [one, { ...one, key: "b/two.json" }] });
    window.location.hash = "objects";
    render(<StorageConsole />);

    await screen.findByText("b/two.json");
    fireEvent.change(screen.getByLabelText("Search objects"), { target: { value: "one" } });

    await waitFor(() => expect(screen.queryByText("b/two.json")).toBeNull());
    expect(screen.getByText("a/one.txt")).toBeTruthy();
  });

  it("shows an object's headers, preview and download", async () => {
    fakeSim({ stored: [one] });
    window.location.hash = "objects";
    render(<StorageConsole />);

    fireEvent.click(await screen.findByText("a/one.txt"));

    expect(await screen.findByText("Content-Length")).toBeTruthy();
    expect(screen.getAllByText("text/plain").length).toBeGreaterThan(0);
    expect(screen.getByText('"5d41402abc4b2a76b9719d911017c592"')).toBeTruthy();
    expect(await screen.findByText("hello")).toBeTruthy();
    const download = screen.getByRole("link", { name: "Download" });
    expect(download.getAttribute("href")).toContain(
      "/_sim/api/object/raw?bucket=uploads&key=a%2Fone.txt&download=1",
    );
  });

  it("says so when nothing has been stored", async () => {
    fakeSim({ stored: [] });
    render(<StorageConsole />);

    expect(await screen.findByText("No buckets yet")).toBeTruthy();
    window.location.hash = "objects";
    fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() => expect(screen.getByText("No objects")).toBeTruthy());
  });
});

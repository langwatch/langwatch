import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("trace sharing page contracts", () => {
  const sharePage = readSource("../../../pages/share/[id].tsx");

  /** @scenario A shared trace opens in the new Trace Explorer surface */
  it("renders Trace Explorer content directly as a full-page view", () => {
    expect(sharePage).toContain("<TraceDrawerContent");
    expect(sharePage).toContain("<DashboardLayout publicPage>");
    expect(sharePage).not.toContain("TraceDrawerShell");
  });

  /** @scenario The shared view offers nothing that needs an account */
  it("puts both the viewer context and trace content in read-only mode", () => {
    expect(sharePage).toMatch(/<TraceViewerProvider[\s\S]*?readOnly/);
    expect(sharePage).toMatch(/<TraceDrawerContent[\s\S]*?readOnly/);
  });

  /** @scenario One page load counts as one view */
  it("deduplicates the token exchange and disables every automatic refetch", () => {
    expect(sharePage).toContain('queryKey: ["share", "resolve", token]');
    expect(sharePage).toContain("staleTime: Infinity");
    expect(sharePage).toContain("cacheTime: Infinity");
    expect(sharePage).toContain("refetchOnMount: false");
    expect(sharePage).toContain("refetchOnWindowFocus: false");
    expect(sharePage).toContain("refetchOnReconnect: false");
  });

  /** @scenario An existing pre-migration share URL still resolves */
  it("backfills legacy ids as the new secret tokens", () => {
    const migration = readSource(
      "../../../../prisma/migrations/20260711000001_rename_public_share_to_share_link/migration.sql",
    );

    expect(migration).toContain(
      'UPDATE "ShareLink" SET "token" = "id" WHERE "token" IS NULL',
    );
    expect(migration).toContain(
      '"visibility" "ShareVisibility" NOT NULL DEFAULT \'PUBLIC\'',
    );
  });

  /** @scenario The legacy trace drawer has no Share affordance */
  it("removes the legacy ShareButton and its drawer integration", () => {
    const traceDetails = readSource(
      "../../../components/traces/TraceDetails.tsx",
    );
    const legacyShareButton = fileURLToPath(
      new URL("../../../components/traces/ShareButton.tsx", import.meta.url),
    );

    expect(traceDetails).not.toContain("ShareButton");
    expect(existsSync(legacyShareButton)).toBe(false);
  });
});

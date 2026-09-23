/**
 * @vitest-environment jsdom
 * What the checkup page shows for each verdict, and what the "what we send"
 * section renders. Spec: specs/self-hosting/checkup/checkup.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { CHECK_DEFINITIONS, type CheckRow } from "@langwatch/ops-contract";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CheckupRows } from "../ui/sections/checkup-rows.tsx";
import { UsageReportSection } from "../ui/sections/usage-report-section.tsx";

function rowsWith(overrides: Partial<Record<CheckRow["id"], CheckRow["verdict"]>>): CheckRow[] {
  return CHECK_DEFINITIONS.map((definition) => ({
    ...definition,
    verdict: overrides[definition.id] ?? {
      outcome: "verified",
      detail: `${definition.name} is fine.`,
    },
  }));
}

function renderRows(rows: CheckRow[]) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <CheckupRows
        rows={rows}
        ranAt="2026-09-21T10:00:00.000Z"
        canManage
        isRunning={false}
        runPlanId=""
        onRunPlanIdChange={() => undefined}
        onRun={() => undefined}
      />
    </ChakraProvider>,
  );
}

describe("CheckupRows", () => {
  describe("when an administrator opens Settings, Checkup", () => {
    /** @scenario "The checkup page lists every row with its verdict" */
    it("lists every check with its verdict, keeps not checked off green, and links the ops dashboard", () => {
      renderRows(
        rowsWith({
          email: {
            outcome: "refused",
            code: "checkup_email_not_configured",
            detail: "No email provider is configured.",
            fix: "Set EMAIL_PROVIDER.",
            docsPath: "/self-hosting/configuration/email",
          },
          reach_connect_host: {
            outcome: "unchecked",
            detail: "Not run. This check opens a connection.",
          },
        }),
      );

      for (const definition of CHECK_DEFINITIONS) {
        expect(screen.getByTestId(`checkup-row-${definition.id}`)).toBeInTheDocument();
      }

      const email = screen.getByTestId("checkup-row-email");
      expect(email.querySelector("[data-outcome]")?.getAttribute("data-outcome")).toBe("refused");
      expect(email).toHaveTextContent("Fail");
      expect(email).toHaveTextContent("Set EMAIL_PROVIDER to smtp");
      expect(email.querySelector("a")?.getAttribute("href")).toBe(
        "https://docs.langwatch.ai/self-hosting/configuration/email",
      );

      const reach = screen.getByTestId("checkup-row-reach_connect_host");
      expect(reach.querySelector("[data-outcome]")?.getAttribute("data-outcome")).toBe("unchecked");
      expect(reach).toHaveTextContent("Not checked");
      expect(reach).not.toHaveTextContent("Pass");

      expect(screen.getByRole("link", { name: /ops dashboard/i })).toHaveAttribute("href", "/ops");
    });

    it("renders registry copy for a refusal whose code the app already explains", () => {
      renderRows(
        rowsWith({
          reach_connect_host: {
            outcome: "refused",
            code: "connect_unreachable",
            detail: "connect.langwatch.ai could not be reached on port 443.",
            fix: "fallback copy",
            docsPath: "/self-hosting/connect",
            meta: { host: "connect.langwatch.ai", port: 443 },
          },
        }),
      );

      const row = screen.getByTestId("checkup-row-reach_connect_host");
      expect(row).toHaveTextContent("connect.langwatch.ai");
      expect(row).toHaveTextContent("443");
      expect(row).not.toHaveTextContent("fallback copy");
    });

    it("offers a run button only on the bands that hold explicit checks", () => {
      renderRows(rowsWith({}));

      expect(screen.queryByTestId("checkup-run-install")).not.toBeInTheDocument();
      expect(screen.getByTestId("checkup-run-langwatch")).toBeInTheDocument();
      expect(screen.getByTestId("checkup-run-integrations")).toBeInTheDocument();
      expect(screen.getByTestId("checkup-run-pipelines")).toBeInTheDocument();
    });
  });
});

describe("UsageReportSection", () => {
  const writeText = vi.fn(async (_text: string) => undefined);

  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText } });
    writeText.mockClear();
  });

  describe("when an administrator opens the what we send section", () => {
    /** @scenario "The usage report preview is copyable" */
    it("shows the payload pretty printed with a copy button and the two switches beside it", async () => {
      const onSwitch = vi.fn();
      const payload = {
        event: "daily_usage_stats",
        instance_id: "4b1c",
        user_email_domains: { "acme.com": 14 },
      };
      render(
        <ChakraProvider value={defaultSystem}>
          <UsageReportSection
            report={{
              payload,
              switches: { optional: true, hostname: false },
              endpoint: "https://connect.langwatch.ai/v1/stats",
              disabled: false,
              schemaVersion: 2,
              nextReportAt: "2026-09-21T12:00:00.000Z",
            }}
            canManage
            isSaving={false}
            onSwitch={onSwitch}
          />
        </ChakraProvider>,
      );

      const pretty = JSON.stringify(payload, null, 2);
      const shown = screen.getByTestId("checkup-usage-report-payload");
      expect(shown).toHaveTextContent('"acme.com": 14');
      expect(shown.textContent).toBe(pretty);

      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
      expect(writeText).toHaveBeenCalledWith(pretty);

      const optional = screen.getByTestId<HTMLInputElement>("checkup-switch-optional-input");
      const hostname = screen.getByTestId<HTMLInputElement>("checkup-switch-hostname-input");
      expect(optional.checked).toBe(true);
      expect(hostname.checked).toBe(false);

      fireEvent.click(optional);
      await waitFor(() => {
        expect(onSwitch).toHaveBeenCalledWith({ optionalMetricsOptOut: true });
      });

      expect(screen.getByText(/connect\.langwatch\.ai/)).toBeInTheDocument();
    });
  });
});

// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TRPCProvider } from "../api";
import { workflowApi } from "../workflow-api";

/**
 * Mounts the REAL provider stack — tRPC client, links, QueryClient — with no
 * mocks. Every page test mocks `~/utils/api`, so a construction-time crash in
 * the client wiring (link config, transformer placement, cache callbacks)
 * reaches no test and blanks every page in the browser instead.
 */
describe("TRPCProvider", () => {
  describe("when mounted with the real client wiring", () => {
    it("renders its children", () => {
      render(
        <TRPCProvider>
          <div>provider-children</div>
        </TRPCProvider>,
      );
      expect(screen.getByText("provider-children")).toBeInTheDocument();
    });

    it("provides the portable workflow client", () => {
      function WorkflowApiProbe() {
        const query = workflowApi.workflow.engineMode.useQuery(
          { projectId: "project_123" },
          { enabled: false },
        );

        return <div>{query.fetchStatus}</div>;
      }

      render(
        <TRPCProvider>
          <WorkflowApiProbe />
        </TRPCProvider>,
      );

      expect(screen.getByText("idle")).toBeInTheDocument();
    });
  });
});

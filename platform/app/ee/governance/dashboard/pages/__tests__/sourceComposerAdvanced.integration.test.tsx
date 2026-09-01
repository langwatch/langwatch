// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * Which settings the source drawers put behind "Advanced".
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * Both of the settings an admin is least often changing — how often we pull,
 * and where the conversations land — sit behind the group, so what is left in
 * plain sight is the handful of things creating a source actually requires.
 *
 * Which makes the group's contents the whole risk: it unmounts what it holds
 * while it is closed, so anything in here that kept its own state would throw
 * the admin's choice away every time they collapsed it. Both fields are driven
 * from the drawer's state, and the reopen tests below are what say so.
 *
 * Driven through the real drawers rather than through `ParserConfigFields`,
 * because the claim is about where the drawers mount these fields, and a
 * harness that mounted them itself would keep passing after the drawers
 * stopped.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SourceComposerDrawer, SourceEditDrawer } from "../inventory";

/**
 * `OttlEditor` calls tRPC on render and is not what this file is about, so it
 * gets the smallest stub that lets the drawers mount — the same one
 * `sourceEditDestination.integration.test.tsx` uses.
 */
vi.mock("~/utils/api", () => ({
  api: {
    ingestionSources: {
      ottlStarter: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
      validateOttl: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          data: undefined,
          error: null,
          reset: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const ORG_ID = "org_acme";

const DESTINATION_CTX = {
  organizationId: ORG_ID,
  organizationName: "Acme",
  availableTeams: [{ id: "team_data", name: "Data" }],
  availableProjects: [
    { id: "proj_analytics", name: "Analytics · Data", teamId: "team_data" },
  ],
};

type ComposerState = Parameters<typeof SourceComposerDrawer>[0]["composer"];

/**
 * The composer holds its state in the page above it, which is exactly the
 * property under test when the Advanced group unmounts its contents. So the
 * harness holds it the same way rather than passing a frozen object.
 */
function ComposerHarness({ sourceType }: { sourceType: string }) {
  const [composer, setComposer] = useState({
    sourceType,
    name: "",
    description: "",
    parserConfig: {},
    ottlStatements: [],
    pullSchedule: "",
    traceProjectId: null,
  } as unknown as ComposerState);
  return (
    <SourceComposerDrawer
      isOpen
      organizationId={ORG_ID}
      destinationCtx={DESTINATION_CTX}
      composer={composer}
      setComposer={setComposer}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      isPending={false}
    />
  );
}

const renderComposer = (sourceType = "databricks_genie") =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ComposerHarness sourceType={sourceType} />
    </ChakraProvider>,
  );

/**
 * Scoped to the field rather than reached through `getByRole("combobox")`:
 * the Genie drawer holds more than one select once Advanced is open.
 */
const destinationPicker = () =>
  screen.getByTestId("ingestion-trace-destination");

/**
 * Opening the group is asynchronous — it mounts its contents on the way — so
 * every caller has to name something it expects to find inside, rather than
 * asserting against a group that has not finished opening.
 */
const openAdvanced = async ({
  user,
  awaiting,
}: {
  user: ReturnType<typeof userEvent.setup>;
  awaiting: "cadence" | "destination";
}) => {
  await user.click(screen.getByText("Advanced"));
  if (awaiting === "cadence") await screen.findByText("Cadence");
  else await screen.findByTestId("ingestion-trace-destination");
};

/**
 * An Anthropic admin source, not a Genie one: the edit form rebuilds adapter
 * configuration for exactly the types on `EDITABLE_PULL_CONFIG_SOURCE_TYPES`,
 * and Genie is not among them, so a Genie edit drawer offers no cadence to
 * place. This type also declares no advanced parser field of its own, which
 * makes it the case that proves the group appears for the extras alone.
 */
const editableSource = {
  id: "src_anthropic",
  name: "Anthropic admin",
  description: "Spend from the Anthropic admin API",
  sourceType: "anthropic_admin",
  parserConfig: { report: "usage" },
  traceProjectId: null,
  traceProjectArchived: false,
  hasPollerCursor: false,
} as unknown as Parameters<typeof SourceEditDrawer>[0]["source"];

/**
 * A push source. It offers neither setting: `routesConversations` excludes
 * push mode by construction, and there is no schedule to pull on. So its
 * drawer must show no Advanced group at all rather than an empty one — a
 * disclosure that opens onto nothing is worse than no disclosure.
 */
const pushSource = {
  id: "src_otel",
  name: "Fleet telemetry",
  description: "Anything that speaks OTLP",
  sourceType: "otel_generic",
  parserConfig: {},
  traceProjectId: null,
  traceProjectArchived: false,
  hasPollerCursor: false,
} as unknown as Parameters<typeof SourceEditDrawer>[0]["source"];

/**
 * A Genie source: the only shape in which the edit drawer offers a
 * destination at all. The two types that route conversations
 * (`routesConversations`) are both absent from
 * `EDITABLE_PULL_CONFIG_SOURCE_TYPES`, so the edit drawer reaches the
 * destination down a path that renders no parser fields — which is why the
 * group cannot simply belong to them.
 */
const routingSource = {
  id: "src_genie",
  name: "Genie fleet",
  description: "Conversations from the Genie workspace",
  sourceType: "databricks_genie",
  parserConfig: { workspaceId: "ws_acme" },
  traceProjectId: null,
  traceProjectArchived: false,
  hasPollerCursor: false,
} as unknown as Parameters<typeof SourceEditDrawer>[0]["source"];

const renderEditDrawer = (source = editableSource) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SourceEditDrawer
        organizationId={ORG_ID}
        destinationCtx={DESTINATION_CTX}
        source={source}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isPending={false}
      />
    </ChakraProvider>,
  );

describe("given the create drawer for a pull-mode conversation source", () => {
  describe("when it first opens", () => {
    /** @scenario "Cadence and destination both sit behind Advanced" */
    it("shows neither the cadence nor the destination picker", () => {
      renderComposer();

      expect(screen.queryByText("Cadence")).toBeNull();
      expect(screen.queryByLabelText("Frequency")).toBeNull();
      expect(screen.queryByTestId("ingestion-trace-destination")).toBeNull();
    });

    /** @scenario "Cadence and destination both sit behind Advanced" */
    it("offers both of them once Advanced is expanded", async () => {
      const user = userEvent.setup();
      renderComposer();

      await openAdvanced({ user, awaiting: "destination" });

      expect(screen.getByText("Cadence")).toBeTruthy();
      expect(screen.getByLabelText<HTMLSelectElement>("Frequency").value).toBe(
        "m15",
      );
    });

    /**
     * Two groups headed "Advanced" in one drawer would leave an admin guessing
     * which of them holds the thing they came for.
     */
    /** @scenario "Cadence and destination both sit behind Advanced" */
    it("puts them in one group, not one each", () => {
      renderComposer();

      expect(screen.getAllByText("Advanced")).toHaveLength(1);
    });
  });

  describe("when the source type declares no advanced parser fields of its own", () => {
    /**
     * Copilot Studio pulls but does not route conversations, so its group has
     * only the cadence to hold — and must still be offered for it alone.
     */
    /** @scenario "Cadence and destination both sit behind Advanced" */
    it("still offers the group, so the cadence stays reachable", async () => {
      const user = userEvent.setup();
      renderComposer("copilot_studio");

      await openAdvanced({ user, awaiting: "cadence" });

      expect(screen.queryByTestId("ingestion-trace-destination")).toBeNull();
    });
  });

  describe("when Advanced is opened, edited, and closed again", () => {
    /**
     * The group unmounts its contents, so a field holding its own state would
     * silently revert every time an admin collapsed the group after choosing
     * something else.
     */
    /** @scenario "Cadence and destination both sit behind Advanced" */
    it("keeps the chosen cadence, because the drawer holds it, not the group", async () => {
      const user = userEvent.setup();
      renderComposer();

      await openAdvanced({ user, awaiting: "cadence" });
      await user.selectOptions(screen.getByLabelText("Frequency"), "hourly");

      await user.click(screen.getByText("Advanced"));
      await waitFor(() => {
        expect(screen.queryByLabelText("Frequency")).toBeNull();
      });
      await openAdvanced({ user, awaiting: "cadence" });

      expect(screen.getByLabelText<HTMLSelectElement>("Frequency").value).toBe(
        "hourly",
      );
    });

    /** @scenario "Cadence and destination both sit behind Advanced" */
    it("keeps the chosen destination for the same reason", async () => {
      const user = userEvent.setup();
      renderComposer();

      await openAdvanced({ user, awaiting: "destination" });
      await user.click(within(destinationPicker()).getByRole("combobox"));
      await user.click(
        within(screen.getByRole("listbox")).getByText("Analytics · Data"),
      );

      await user.click(screen.getByText("Advanced"));
      await waitFor(() => {
        expect(screen.queryByTestId("ingestion-trace-destination")).toBeNull();
      });
      await openAdvanced({ user, awaiting: "destination" });

      expect(
        within(destinationPicker()).getByRole("combobox").textContent,
      ).toContain("Analytics · Data");
    });
  });
});

describe("given the edit drawer for a source whose cadence it can rebuild", () => {
  describe("when it opens", () => {
    /**
     * The two forms edit the same source, so a setting that lives behind
     * Advanced in one and in plain sight in the other would mean an admin who
     * learned the drawer once has to learn it again.
     */
    /** @scenario "Cadence and destination both sit behind Advanced" */
    it("places cadence behind Advanced, exactly as the create drawer does", async () => {
      const user = userEvent.setup();
      renderEditDrawer();

      expect(screen.queryByText("Cadence")).toBeNull();

      await user.click(screen.getByText("Advanced"));

      await waitFor(() => {
        expect(screen.getByText("Cadence")).toBeTruthy();
      });
    });
  });
});

describe("given the edit drawer for a source that routes conversations", () => {
  describe("when it opens", () => {
    /** @scenario "Cadence and destination both sit behind Advanced" */
    it("puts the destination behind Advanced too", async () => {
      const user = userEvent.setup();
      renderEditDrawer(routingSource);

      expect(screen.queryByTestId("ingestion-trace-destination")).toBeNull();
      expect(screen.getAllByText("Advanced")).toHaveLength(1);

      await openAdvanced({ user, awaiting: "destination" });
    });
  });
});

describe("given the edit drawer for a push source, which offers neither setting", () => {
  describe("when it opens", () => {
    /** @scenario "Cadence and destination both sit behind Advanced" */
    it("offers no Advanced group at all, rather than an empty one", () => {
      renderEditDrawer(pushSource);

      expect(screen.queryByText("Advanced")).toBeNull();
    });
  });
});

describe("given the create drawer for a push source, which offers neither setting", () => {
  describe("when it opens", () => {
    /** @scenario "Cadence and destination both sit behind Advanced" */
    it("offers no Advanced group at all, rather than an empty one", () => {
      renderComposer("otel_generic");

      expect(screen.queryByText("Advanced")).toBeNull();
    });
  });
});

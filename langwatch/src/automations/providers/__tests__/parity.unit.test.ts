import { AlertType, TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { renderLiquid } from "~/shared/templating/engine";
import { EXAMPLE_MATCHES } from "~/shared/templating/exampleContext";
import { buildTemplateContext } from "~/shared/templating/templateContext";
import { CLIENT_PROVIDERS, NOTIFY_PROVIDERS, ACTION_PROVIDERS } from "../client";
import { SERVER_PROVIDERS } from "../server";
import { SLACK_BLOCK_KIT_TEMPLATES } from "../definitions/slack/templates/registry";

/**
 * The provider system enforces two invariants here. Failures mean the
 * registries have drifted from the `TriggerAction` enum or each other —
 * which would silently break the drawer or the server dispatcher when a
 * new action type lands. Keep this test passing.
 */
describe("provider registry parity", () => {
  describe("given the TriggerAction enum", () => {
    describe("when registries are built", () => {
      it("registers every TriggerAction on the client", () => {
        for (const action of Object.values(TriggerAction)) {
          expect(CLIENT_PROVIDERS[action]).toBeDefined();
          expect(CLIENT_PROVIDERS[action].shared.action).toBe(action);
        }
      });

      it("registers every TriggerAction on the server", () => {
        for (const action of Object.values(TriggerAction)) {
          expect(SERVER_PROVIDERS[action]).toBeDefined();
          expect(SERVER_PROVIDERS[action].shared.action).toBe(action);
        }
      });

      it("shares the same shared definition between client and server per action", () => {
        for (const action of Object.values(TriggerAction)) {
          expect(CLIENT_PROVIDERS[action].shared).toBe(
            SERVER_PROVIDERS[action].shared,
          );
        }
      });

      it("partitions the enum between notify and action categories", () => {
        const notifyActions = NOTIFY_PROVIDERS.map((p) => p.shared.action);
        const actionActions = ACTION_PROVIDERS.map((p) => p.shared.action);
        expect(new Set([...notifyActions, ...actionActions])).toEqual(
          new Set(Object.values(TriggerAction)),
        );
        expect(notifyActions.some((a) => actionActions.includes(a))).toBe(false);
      });

      it("gives notify providers a channel string the preview/testFire endpoints accept", () => {
        for (const p of NOTIFY_PROVIDERS) {
          expect(["email", "slack"]).toContain(p.client.channel);
        }
      });

      it("exposes a config form, an icon, and the slice helpers on every provider", () => {
        for (const action of Object.values(TriggerAction)) {
          const p = CLIENT_PROVIDERS[action];
          expect(p.client.Icon).toBeDefined();
          expect(p.client.ConfigForm).toBeDefined();
          expect(typeof p.client.initialSlice).toBe("function");
          expect(typeof p.client.isComplete).toBe("function");
          expect(typeof p.client.summary).toBe("function");
          expect(typeof p.client.fromTriggerRow).toBe("function");
          expect(typeof p.client.toActionParams).toBe("function");
        }
      });
    });
  });

  describe("given the bundled Slack Block Kit templates", () => {
    const baseContext = {
      trigger: {
        id: "tr_1",
        name: "High latency",
        alertType: AlertType.WARNING,
      },
      project: { name: "Acme", slug: "acme" },
      baseHost: "https://app.langwatch.ai",
      matches: EXAMPLE_MATCHES,
    };
    const contextsByCadence = {
      immediate: buildTemplateContext(baseContext),
      digest: buildTemplateContext({
        ...baseContext,
        window: {
          start: new Date("2026-01-01T10:00:00Z"),
          end: new Date("2026-01-01T11:00:00Z"),
        },
      }),
    } as const;

    describe("when each template renders against the example context for its cadence", () => {
      it.each(SLACK_BLOCK_KIT_TEMPLATES.map((t) => [t.id, t] as const))(
        "%s produces a non-empty Block Kit blocks array",
        async (_id, template) => {
          const cadences =
            template.cadenceFit === "both"
              ? (["immediate", "digest"] as const)
              : ([template.cadenceFit] as const);
          for (const cadence of cadences) {
            const { output } = await renderLiquid({
              template: template.source,
              context: contextsByCadence[
                cadence
              ] as unknown as Record<string, unknown>,
            });
            const blocks: unknown = JSON.parse(output);
            expect(Array.isArray(blocks)).toBe(true);
            expect((blocks as unknown[]).length).toBeGreaterThan(0);
          }
        },
      );
    });
  });
});

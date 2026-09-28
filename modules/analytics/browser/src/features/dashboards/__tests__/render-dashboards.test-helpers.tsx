/**
 * Renders a Dashboards component the way the shell does: the analytics host
 * double, and the real tRPC hooks over a transport whose network answers from
 * the test. Nothing in the query layer is mocked.
 */

import { createUiQueryClient } from "@langwatch/browser-host/query-client";
import {
  answeringUiTransport,
  type UiProcedureAnswer,
} from "@langwatch/browser-host/testing-transport";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { AnalyticsTestHarness, type StubAnalyticsHost } from "../../../testing.tsx";

/** An answer for a test that expects no procedure to run: any call fails by name. */
export const NO_PROCEDURES: UiProcedureAnswer = ({ path }) =>
  Promise.reject(new Error(`No test answer for ${path}`));

export function renderDashboards({
  element,
  host,
  answer = NO_PROCEDURES,
}: {
  element: ReactElement;
  host: StubAnalyticsHost;
  answer?: UiProcedureAnswer;
}) {
  const queryClient = createUiQueryClient({ onMutationError: () => void 0 });
  return render(
    <AnalyticsTestHarness host={host}>
      <analyticsApi.Provider client={answeringUiTransport(answer)} queryClient={queryClient}>
        {element}
      </analyticsApi.Provider>
    </AnalyticsTestHarness>,
  );
}

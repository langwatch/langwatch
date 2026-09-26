// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { VStack } from "@chakra-ui/react";

import { useGovernanceScope } from "../../../../behavior/governance-session.ts";
import { useSampleMode } from "../../../../ui/elements/governance-sample-mode.ts";
import { SampleDataBanner } from "../../../../ui/elements/sample-data-controls.tsx";
import GovernanceLayout from "../../../../ui/sections/governance-layout.tsx";
import { useCostFilters, useDepartmentSelectionReset } from "../../behavior/use-cost-filters.ts";
import { useCostScreenReads } from "../../behavior/use-cost-reads.ts";
import { useSamplePeriods } from "../../behavior/use-sample-series.ts";
import { isRefusedRead } from "../../model/cost-sample-mode.ts";
import { windowDaysForFrame } from "../../model/costs-window.ts";
import { summaryHoldsFigures } from "../../model/measured-rows.ts";
import { SAMPLE_DEPARTMENTS } from "../../model/sample-series.ts";
import { CostFilterBar } from "../blocks/cost-filter-bar.tsx";
import { SampleSaidOnce } from "../elements/sample-mark.tsx";
import { CostBreakdowns } from "./cost-breakdowns.tsx";
import { CostsBody } from "./costs-body.tsx";
import { CostsHeader } from "./costs-header.tsx";
import { ReadCeilingNotice } from "./costs-notices.tsx";

/**
 * The cost screen: three lanes, side by side, each labeled for what it is,
 * and the breakdowns underneath them.
 *
 * The lanes are never added together. What a provider invoices and what the
 * gateway metered are two different measurements of overlapping traffic, and
 * the gap between them is the thing worth looking at — a combined figure would
 * hide exactly what the screen exists to show. That is why nothing on this page
 * shows a single "total AI cost".
 *
 * Nothing here ever renders a zero it did not measure. A failed read, a
 * deployment without a cost store, and a lane with no figure all render as
 * such; `$0.00` is reserved for a lane that really did report no spend.
 *
 * ONE TIME AXIS. Two chips set the window: Time Frame (how far back) and Time
 * Interval (how wide each bucket is), the section-wide pair from
 * `~/components/governance/filters`, opening on Quarter over the last twelve
 * months. Every chart on the page is bucketed and ticked by that interval,
 * because a screen set to Quarter that still draws one chart by day puts two
 * axes side by side that look alike and are not the same span — the one chart
 * mistake a reader has no way to catch. The reads answer in days and take no
 * bucket parameter, so the fold happens on the client; `costsWindow.ts` says
 * why, and why the frame is clamped to the reads' 365-day ceiling.
 *
 * SAMPLE MODE SUPPRESSES FAILURE. With sample data on, no error alert renders
 * and no panel says "not available": the lanes, the breakdowns and the spender
 * list all draw invented figures under the sample badge instead. The screen's
 * job in that mode is to show what a filled-in Costs page looks like, and a
 * red alert across the top of it does not. Everything real comes straight back
 * the moment the reader turns sample data off — that toggle is the exit, and
 * it is always on screen.
 *
 * The invented panels do not render unconditionally. They fill a screen with
 * nothing measured on it, step aside once real figures arrive, and the reader
 * can overrule either default from the toggle in the header — the same
 * arrangement the trace explorer uses for its sample traces. See
 * `~/components/governance/sample` for why an unanswered read is not
 * treated as an empty one.
 *
 * Spec: specs/governance/governance-cost-screen.feature (ADR-128)
 */

export function CostsPage() {
  const { organization, hasAnyPermission } = useGovernanceScope();
  const organizationId = organization?.id ?? "";
  const { filters, setFilters, patch, chooseFrame } = useCostFilters();

  const windowDays = windowDaysForFrame({ frame: filters.frame });

  const { summary, providerDays, breakdowns, spenders, busy, refresh } = useCostScreenReads({
    organizationId,
    windowDays,
    hasAnyPermission,
  });

  const { active: showSample, toggle: toggleSample } = useSampleMode();
  const samplePeriods = useSamplePeriods(filters.frame);

  useDepartmentSelectionReset({ filters, breakdowns, setFilters, showSample });

  const departmentOptions = showSample
    ? SAMPLE_DEPARTMENTS.map((name) => ({ id: name, name }))
    : breakdowns.departments;
  const holdsFigures = summaryHoldsFigures(summary.data, summary.isError);

  return (
    <GovernanceLayout pageTitle="Costs · AI Governance · LangWatch">
      <VStack align="stretch" gap={5} width="full">
        <CostsHeader
          lastReadAt={summary.dataUpdatedAt}
          busy={busy}
          onRefresh={refresh}
          showSample={showSample}
          onToggleSample={toggleSample}
        />
        {showSample && <SampleDataBanner />}
        {/* Everything under the banner inherits what the banner said. While it
            is up, the per-panel marks stand down rather than restating it
            sixteen times; the moment it comes down they are the only thing
            telling an invented panel from a measured one, and they return.
            `sampleMark.tsx` carries the reasoning. */}
        <SampleSaidOnce said={showSample}>
          <CostFilterBar
            departmentName={filters.departmentName}
            departments={departmentOptions}
            onDepartmentChange={(department, departmentName) =>
              patch({ department, departmentName })
            }
            frame={filters.frame}
            onFrameChange={chooseFrame}
            interval={filters.interval}
            onIntervalChange={(interval) => patch({ interval })}
          />
          <ReadCeilingNotice frame={filters.frame} showSample={showSample} />

          <CostsBody
            isLoading={summary.isLoading && !!organizationId}
            isError={summary.isError}
            refused={isRefusedRead(summary.error)}
            data={summary.data}
            interval={filters.interval}
            showSample={showSample}
            samplePeriods={samplePeriods}
          />

          <CostBreakdowns
            filters={filters}
            breakdowns={breakdowns}
            periods={samplePeriods}
            showSample={showSample}
            spenders={spenders}
            sourcesConnected={holdsFigures}
            organizationId={organizationId}
            providerDays={providerDays.data?.rows ?? null}
            hasProviderDaysFailure={providerDays.isError}
          />
        </SampleSaidOnce>
      </VStack>
    </GovernanceLayout>
  );
}

export default CostsPage;

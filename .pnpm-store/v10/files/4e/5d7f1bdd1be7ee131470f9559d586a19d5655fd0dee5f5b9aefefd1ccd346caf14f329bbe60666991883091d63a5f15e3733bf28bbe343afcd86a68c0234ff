/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Splits a ResourceMetrics object into smaller ResourceMetrics objects
 * such that no batch exceeds maxExportBatchSize data points.
 * @param resourceMetrics The metrics to split.
 * @param maxExportBatchSize The maximum number of data points per batch.
 * @internal
 */
export function splitMetricData(resourceMetrics, maxExportBatchSize) {
    if (!Number.isInteger(maxExportBatchSize) || maxExportBatchSize <= 0) {
        throw new Error('maxExportBatchSize must be a positive integer');
    }
    const batches = [];
    let currentBatchPoints = 0;
    let currentScopeMetrics = [];
    function flush() {
        if (currentScopeMetrics.length > 0) {
            batches.push({
                resource: resourceMetrics.resource,
                scopeMetrics: currentScopeMetrics,
            });
            currentScopeMetrics = [];
            currentBatchPoints = 0;
        }
    }
    // Iterate through all scopes in the input metrics
    for (const scopeMetric of resourceMetrics.scopeMetrics) {
        let scopeMetricCopy = null;
        // Iterate through all metrics within the current scope
        for (const metric of scopeMetric.metrics) {
            const dataPoints = metric.dataPoints;
            // If a metric has no data points, add it directly to the current batch
            if (dataPoints.length === 0) {
                if (!scopeMetricCopy) {
                    scopeMetricCopy = { scope: scopeMetric.scope, metrics: [] };
                    currentScopeMetrics.push(scopeMetricCopy);
                }
                scopeMetricCopy.metrics.push(metric);
                continue;
            }
            // Chunk the data points of the current metric across batches. We iterate
            // with an offset instead of repeatedly slicing the remaining tail, which
            // keeps the overall work linear in the number of data points.
            let offset = 0;
            while (offset < dataPoints.length) {
                const spaceLeft = maxExportBatchSize - currentBatchPoints;
                const take = Math.min(spaceLeft, dataPoints.length - offset);
                // Ensure we have a ScopeMetrics object in the current batch
                if (!scopeMetricCopy) {
                    scopeMetricCopy = { scope: scopeMetric.scope, metrics: [] };
                    currentScopeMetrics.push(scopeMetricCopy);
                }
                // A metric receives exactly one contiguous chunk per batch (after
                // appending, the batch is either full and flushed, or the metric is
                // exhausted), so we can slice the data points directly rather than
                // copying them incrementally.
                const metricCopy = {
                    ...metric,
                    dataPoints: dataPoints.slice(offset, offset + take),
                };
                scopeMetricCopy.metrics.push(metricCopy);
                offset += take;
                currentBatchPoints += take;
                // If the current batch is full, flush it and start a new one
                if (currentBatchPoints === maxExportBatchSize) {
                    flush();
                    scopeMetricCopy = null; // Force recreation of scope copy in the next batch
                }
            }
        }
    }
    flush();
    return batches;
}
//# sourceMappingURL=MetricDataSplitter.js.map
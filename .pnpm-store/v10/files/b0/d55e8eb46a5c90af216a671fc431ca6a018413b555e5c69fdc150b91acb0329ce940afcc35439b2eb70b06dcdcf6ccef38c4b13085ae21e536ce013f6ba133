/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
export const MetricsExporterMetricsHelper = {
    name: 'metric_data_point',
    countItems: (request) => {
        let count = 0;
        for (const scopeMetrics of request.scopeMetrics) {
            for (const metric of scopeMetrics.metrics) {
                count += metric.dataPoints.length;
            }
        }
        return count;
    },
};
//# sourceMappingURL=index.js.map
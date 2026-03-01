import { resourceFromAttributes } from "@opentelemetry/resources";
import { setupObservability } from "langwatch/observability/node";

setupObservability({
	serviceName: "mastra_example",
	resource: resourceFromAttributes({
		"langwatch.metadata": JSON.stringify({
			labels: ["mastra-example"],
		}),
	}),
	debug: {
		consoleTracing: true,
	},
});

/** The graph fields automation evaluation and list enrichment need. */
export type CustomGraph = {
	id: string;
	projectId: string;
	name: string;
	graph: unknown;
	filters: unknown;
};

export type CustomGraphNameRef = Pick<CustomGraph, "id" | "name">;

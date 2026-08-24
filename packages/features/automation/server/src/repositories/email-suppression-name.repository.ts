export type UnsubscribeNames = {
	projectName: string;
	triggerName: string | null;
};
export abstract class EmailSuppressionNameRepository {
	abstract tryLookupNames(input: {
		projectId: string;
		triggerId: string | null;
	}): Promise<UnsubscribeNames | null>;
	abstract findTriggerNames(input: {
		projectId: string;
		triggerIds: string[];
	}): Promise<Map<string, string>>;
}

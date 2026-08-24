import {
	emailSuppressionSchema,
	type EmailSuppression,
} from "@langwatch/automation-contract";
import type { AutomationDatabase } from "../../ports/automation-database.port";
import { EmailSuppressionRepository } from "../email-suppression.repository";
const map = (row: unknown): EmailSuppression =>
	emailSuppressionSchema.parse(row);
export class PrismaEmailSuppressionRepository extends EmailSuppressionRepository {
	private constructor(private readonly database: AutomationDatabase) {
		super();
	}
	static create(
		database: AutomationDatabase,
	): PrismaEmailSuppressionRepository {
		return new PrismaEmailSuppressionRepository(database);
	}
	async findAll(input: { projectId: string }): Promise<EmailSuppression[]> {
		return (
			await this.database.emailSuppression.findMany({
				where: input,
				orderBy: { createdAt: "desc" },
			})
		).map(map);
	}
	async findMatching(input: {
		projectId: string;
		triggerId: string;
	}): Promise<EmailSuppression[]> {
		return (
			await this.database.emailSuppression.findMany({
				where: {
					projectId: input.projectId,
					OR: [{ triggerId: null }, { triggerId: input.triggerId }],
				},
			})
		).map(map);
	}
	async create(input: {
		projectId: string;
		email: string;
		triggerId: string | null;
		reason: string;
	}): Promise<EmailSuppression> {
		try {
			return map(await this.database.emailSuppression.create({ data: input }));
		} catch (error) {
			const code = (error as { code?: unknown }).code;
			if (code !== "P2002") throw error;
			const existing = await this.database.emailSuppression.findFirst({
				where: input,
			});
			if (existing === null) throw error;
			return map(existing);
		}
	}
	async delete(input: { id: string; projectId: string }): Promise<void> {
		await this.database.emailSuppression.deleteMany({ where: input });
	}
}

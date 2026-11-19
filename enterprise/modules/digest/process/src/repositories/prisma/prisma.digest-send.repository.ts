// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";

import type { DigestSendRecord, DigestSendRepository } from "../digest-send.repository.ts";

/** One row per person and week; its id is the pair, so only the first insert of a week lands. */
const sendIdOf = ({ userId, isoWeek }: { userId: string; isoWeek: string }) =>
  `${userId}:${isoWeek}`;

export class PrismaDigestSendRepository
  extends PrismaRepository.for("DigestSend")
  implements DigestSendRepository
{
  static readonly create = this.factory((prisma) => new PrismaDigestSendRepository(prisma));

  async isSent(input: { userId: string; isoWeek: string }): Promise<boolean> {
    const row = await this.prisma.digestSend.findUnique({
      where: { id: sendIdOf(input) },
      select: { id: true },
    });
    return row !== null;
  }

  async claim({ sentAt, ...send }: DigestSendRecord): Promise<boolean> {
    // ON CONFLICT DO NOTHING: two racing attempts both return, and only one counts a row.
    const { count } = await this.prisma.digestSend.createMany({
      data: [{ id: sendIdOf(send), ...send, sentAt: new Date(sentAt) }],
      skipDuplicates: true,
    });
    return count === 1;
  }
}

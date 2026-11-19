// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";

import type { DigestSendRecord, DigestSendRepository } from "../digest-send.repository.ts";

/** One row per person and week; its id is the pair, so a second record is a no-op upsert. */
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

  async recordSent({ sentAt, ...send }: DigestSendRecord): Promise<void> {
    const id = sendIdOf(send);
    await this.prisma.digestSend.upsert({
      where: { id },
      create: { id, ...send, sentAt: new Date(sentAt) },
      update: {},
    });
  }
}

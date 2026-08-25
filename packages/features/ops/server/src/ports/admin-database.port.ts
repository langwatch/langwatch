import type { ImpersonationTarget } from "../services/impersonation.service";

/** Structural database capability consumed by the private Prisma repository. */
export interface AdminDatabase {
  user: {
    findUnique(input: {
      where: { id: string };
      select: {
        id: true;
        name: true;
        email: true;
        image: true;
        deactivatedAt: true;
      };
    }): Promise<ImpersonationTarget | null>;
  };
  session: {
    update(input: {
      where: { id: string };
      // Prisma's JSON null sentinel is intentionally opaque at this boundary.
      data: { impersonating: any };
    }): Promise<unknown>;
  };
}

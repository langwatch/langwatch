export interface SsoDatabase {
  organization: {
    findMany(input: {
      where: { license: { not: null } };
      select: { id: true; license: true };
    }): Promise<Array<{ id: string; license: string | null }>>;
  };
}

/** Which datasets the single-file conversion still has to convert; it reads only. */
export interface DatasetSingleFileConversionRepository {
  /** One id-ordered page of a project's single-file datasets, archived ones included. */
  findSingleFileDatasetIds(input: {
    projectId: string;
    afterId?: string | undefined;
    limit: number;
  }): Promise<string[]>;
}

import { DEFAULT_ENDPOINT } from "@/internal/constants";

export type DatasetColumnType = {
  name: string;
  type: string;
};

export type DatasetSummary = {
  id: string;
  name: string;
  slug: string;
  columnTypes: DatasetColumnType[];
  createdAt: string;
  updatedAt: string;
  recordCount: number;
};

export type DatasetRecord = {
  id: string;
  datasetId: string;
  projectId: string;
  entry: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type DatasetDetail = {
  id: string;
  name: string;
  slug: string;
  columnTypes: DatasetColumnType[];
  createdAt: string;
  updatedAt: string;
  data: DatasetRecord[];
};

export type PaginatedResponse<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type ListDatasetsResponse = PaginatedResponse<DatasetSummary>;

export class DatasetsCliServiceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DatasetsCliServiceError";
  }
}

export class DatasetsCliService {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor() {
    this.apiKey = process.env.LANGWATCH_API_KEY ?? "";
    this.endpoint = (
      process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT
    ).replace(/\/$/, "");
  }

  private get headers(): Record<string, string> {
    return {
      "x-auth-token": this.apiKey,
      authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const body = await response.text();
      let message: string;
      try {
        const json = JSON.parse(body);
        message = json.message ?? json.error ?? body;
      } catch {
        message = body;
      }
      throw new DatasetsCliServiceError(message, response.status);
    }
    return response.json() as Promise<T>;
  }

  async list({
    page = 1,
    limit = 50,
  }: { page?: number; limit?: number } = {}): Promise<ListDatasetsResponse> {
    const url = `${this.endpoint}/api/dataset?page=${page}&limit=${limit}`;
    const response = await fetch(url, { headers: this.headers });
    return this.handleResponse<ListDatasetsResponse>(response);
  }

  async create({
    name,
    columnTypes = [],
  }: {
    name: string;
    columnTypes?: DatasetColumnType[];
  }): Promise<DatasetDetail> {
    const url = `${this.endpoint}/api/dataset`;
    const response = await fetch(url, {
      method: "POST",
      headers: { ...this.headers, "content-type": "application/json" },
      body: JSON.stringify({ name, columnTypes }),
    });
    return this.handleResponse<DatasetDetail>(response);
  }

  async get(slugOrId: string): Promise<DatasetDetail> {
    const url = `${this.endpoint}/api/dataset/${encodeURIComponent(slugOrId)}`;
    const response = await fetch(url, { headers: this.headers });
    return this.handleResponse<DatasetDetail>(response);
  }

  async delete(slugOrId: string): Promise<{ success: boolean }> {
    const url = `${this.endpoint}/api/dataset/${encodeURIComponent(slugOrId)}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.headers,
    });
    return this.handleResponse<{ success: boolean }>(response);
  }

  async listRecords({
    slugOrId,
    page = 1,
    limit = 1000,
  }: {
    slugOrId: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<DatasetRecord>> {
    const url = `${this.endpoint}/api/dataset/${encodeURIComponent(slugOrId)}/records?page=${page}&limit=${limit}`;
    const response = await fetch(url, { headers: this.headers });
    return this.handleResponse<PaginatedResponse<DatasetRecord>>(response);
  }

  async getAllRecords(slugOrId: string): Promise<DatasetRecord[]> {
    const allRecords: DatasetRecord[] = [];
    let page = 1;

    while (true) {
      const result = await this.listRecords({ slugOrId, page, limit: 1000 });
      allRecords.push(...result.data);

      if (page >= result.pagination.totalPages) break;
      page++;
    }

    return allRecords;
  }

  async uploadToExisting({
    slugOrId,
    content,
    filename,
  }: {
    slugOrId: string;
    content: string;
    filename: string;
  }): Promise<{ uploadedCount: number }> {
    const formData = new FormData();
    formData.append("file", new Blob([content], { type: "text/plain" }), filename);

    const url = `${this.endpoint}/api/dataset/${encodeURIComponent(slugOrId)}/upload`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: formData,
    });
    return this.handleResponse<{ uploadedCount: number }>(response);
  }

  async createFromUpload({
    name,
    content,
    filename,
  }: {
    name: string;
    content: string;
    filename: string;
  }): Promise<DatasetDetail & { recordCount: number }> {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("file", new Blob([content], { type: "text/plain" }), filename);

    const url = `${this.endpoint}/api/dataset/upload`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: formData,
    });
    return this.handleResponse<DatasetDetail & { recordCount: number }>(
      response,
    );
  }
}

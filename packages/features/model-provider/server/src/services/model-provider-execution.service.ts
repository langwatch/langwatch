import {
  DEFAULT_AZURE_API_VERSION,
  isCodexModel,
  ModelProviderInvalidError,
  ModelProviderNotFoundError,
  ModelRestrictedForExecutionError,
  modelProviderExecutionParametersSchema,
  modelProviderExecutionPrepareInputSchema,
  translateModelIdForLitellm,
  type ModelProvider,
  type ModelProviderExecution,
  type ModelProviderExecutionParameters,
  type ModelProviderExecutionPrepareInput,
} from "@langwatch/model-provider-contract";
import type { ModelProviderCatalog } from "../ports/model-provider.port";
import { ModelProviderQueryService } from "./model-provider-query.service";

type ModelProviderExecutionOptions = {
  query: ModelProviderQueryService;
  catalog: ModelProviderCatalog;
};

/** Builds the one portable execution parameter shape used by every runner. */
export class ModelProviderExecutionService {
  private constructor(private readonly options: ModelProviderExecutionOptions) {}

  static create(options: ModelProviderExecutionOptions): ModelProviderExecutionService {
    return new ModelProviderExecutionService(options);
  }

  async prepare(
    input: ModelProviderExecutionPrepareInput,
  ): Promise<ModelProviderExecutionParameters> {
    const parsed = modelProviderExecutionPrepareInputSchema.parse(input);
    this.assertCodexCanNotExecute(parsed.model, null);
    const provider = await this.resolveProvider(parsed);
    this.assertCodexCanNotExecute(parsed.model, provider.provider);

    const parameters = this.baseParameters(parsed.model, provider.provider);
    this.addApiParameters(parameters, provider);
    this.addVertexParameters(parameters, provider);
    this.addGeminiParameters(parameters, provider);
    this.addBedrockParameters(parameters, provider);
    this.addAzureParameters(parameters, provider);

    const resolved = await this.options.catalog.prepareExecution({
      parameters,
      projectId: parsed.projectId,
      model: parsed.model,
      provider: provider.provider,
    });
    return modelProviderExecutionParametersSchema.parse(resolved);
  }

  private async resolveProvider(
    input: ModelProviderExecutionPrepareInput,
  ): Promise<ModelProvider | ModelProviderExecution> {
    const reference = parseModelReference(input.model);
    if (!reference) {
      throw new ModelProviderInvalidError(
        "Model references must include both a provider and model name.",
      );
    }

    if (reference.kind === "row") {
      const provider = await this.options.query.tryGetByIdForProject({
        id: reference.id,
        projectId: input.projectId,
      });
      if (!provider) {
        throw new ModelProviderNotFoundError();
      }
      return provider;
    }

    const providers = await this.options.query.getExecutionProviders({
      projectId: input.projectId,
    });
    const selected = providers[reference.provider];
    if (!selected) {
      throw new ModelProviderNotFoundError();
    }

    if (this.providerServesModel(selected, reference.model)) {
      return selected;
    }

    return (
      (await this.options.query.tryFindRowServingModel({
        projectId: input.projectId,
        provider: selected.provider,
        model: reference.model,
      })) ?? selected
    );
  }

  private assertCodexCanNotExecute(model: string, provider: string | null): void {
    if (isCodexModel(model) || provider === "openai_codex") {
      throw new ModelRestrictedForExecutionError({ model, provider });
    }
  }

  private baseParameters(
    model: string,
    provider: string,
  ): ModelProviderExecutionParameters {
    const modelName = modelNameForProvider(model, provider);
    return {
      model: translateModelIdForLitellm(modelName).replace("custom/", "openai/"),
    };
  }

  private addApiParameters(
    parameters: ModelProviderExecutionParameters,
    provider: ModelProvider | ModelProviderExecution,
  ): void {
    const definition = this.options.catalog.tryGetExecutionDefinition({
      provider: provider.provider,
    });
    const apiKey = definition ? this.executionValue(provider, definition.apiKey) : null;
    if (apiKey && provider.provider !== "vertex_ai") {
      parameters.api_key = apiKey;
    }

    const endpoint = definition?.endpointKey
      ? this.executionValue(provider, definition.endpointKey)
      : null;
    if (!endpoint) {
      return;
    }
    parameters.api_base =
      provider.provider === "anthropic" ? endpoint.replace(/\/v1\/?$/, "") : endpoint;
  }

  private addVertexParameters(
    parameters: ModelProviderExecutionParameters,
    provider: ModelProvider | ModelProviderExecution,
  ): void {
    if (provider.provider !== "vertex_ai") {
      return;
    }

    parameters.vertex_credentials =
      this.executionValue(provider, "VERTEXAI_API_KEY") ?? "invalid";
    parameters.vertex_project =
      this.executionValue(provider, "VERTEXAI_PROJECT") ?? "invalid";
    parameters.vertex_location =
      this.executionValue(provider, "VERTEXAI_LOCATION") ?? "invalid";
  }

  private addGeminiParameters(
    parameters: ModelProviderExecutionParameters,
    provider: ModelProvider | ModelProviderExecution,
  ): void {
    if (provider.provider !== "gemini") {
      return;
    }

    const storedApiKey = this.storedExecutionValue(provider, "GEMINI_API_KEY");
    const apiKey = storedApiKey ?? this.executionValue(provider, "GEMINI_API_KEY");
    if (!apiKey) {
      return;
    }
    const project = (
      storedApiKey
        ? this.storedExecutionValue(provider, "GEMINI_PROJECT")
        : this.executionValue(provider, "GEMINI_PROJECT")
    )?.trim();
    const location = (
      storedApiKey
        ? this.storedExecutionValue(provider, "GEMINI_LOCATION")
        : this.executionValue(provider, "GEMINI_LOCATION")
    )?.trim();
    if (project && location) {
      parameters.project_id = project;
      parameters.region = location;
    }
  }

  private addBedrockParameters(
    parameters: ModelProviderExecutionParameters,
    provider: ModelProvider | ModelProviderExecution,
  ): void {
    if (provider.provider !== "bedrock") {
      return;
    }

    delete parameters.api_key;
    parameters.aws_access_key_id =
      this.executionValue(provider, "AWS_ACCESS_KEY_ID") ?? "invalid";
    parameters.aws_secret_access_key =
      this.executionValue(provider, "AWS_SECRET_ACCESS_KEY") ?? "invalid";
    parameters.aws_region_name =
      this.executionValue(provider, "AWS_REGION_NAME") ?? "invalid";
  }

  private addAzureParameters(
    parameters: ModelProviderExecutionParameters,
    provider: ModelProvider | ModelProviderExecution,
  ): void {
    if (provider.provider !== "azure") {
      return;
    }

    const gatewayBaseUrl = this.executionValue(provider, "AZURE_API_GATEWAY_BASE_URL");
    if (gatewayBaseUrl) {
      parameters.api_base = gatewayBaseUrl;
      parameters.use_azure_gateway = "true";
      parameters.api_version =
        this.executionValue(provider, "AZURE_API_GATEWAY_VERSION") ??
        "2024-05-01-preview";
    } else {
      parameters.api_version =
        this.executionValue(provider, "AZURE_OPENAI_API_VERSION") ??
        DEFAULT_AZURE_API_VERSION;
    }

    const model = parameters.model;
    if (!model) {
      throw new ModelProviderInvalidError("Execution parameters are missing a model.");
    }
    const deployment = deploymentForModel(provider.deploymentMapping, model);
    if (deployment) {
      parameters.deployment = deployment;
    }
    if (provider.extraHeaders.length > 0) {
      parameters.extra_headers = JSON.stringify(
        Object.fromEntries(provider.extraHeaders.map(({ key, value }) => [key, value])),
      );
    }
  }

  private executionValue(
    provider: ModelProvider | ModelProviderExecution,
    key: string | null,
  ): string | null {
    if (!key) {
      return null;
    }
    return this.options.catalog.tryGetExecutionValue({
      customKeys: provider.customKeys,
      key,
    });
  }

  private storedExecutionValue(
    provider: ModelProvider | ModelProviderExecution,
    key: string,
  ): string | null {
    return this.options.catalog.tryGetStoredExecutionValue({
      customKeys: provider.customKeys,
      key,
    });
  }

  private providerServesModel(provider: ModelProviderExecution, model: string): boolean {
    return (
      provider.models?.includes(model) === true ||
      provider.embeddingsModels?.includes(model) === true ||
      provider.customModels.some((candidate) => candidate.id === model) ||
      provider.customEmbeddingsModels.some((candidate) => candidate.id === model)
    );
  }
}

function parseModelReference(
  value: string,
):
  | { kind: "provider"; provider: string; model: string }
  | { kind: "row"; id: string }
  | null {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }

  const prefix = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (prefix.startsWith("mp_")) {
    return { kind: "row", id: prefix };
  }
  return { kind: "provider", provider: prefix, model };
}

function modelNameForProvider(model: string, provider: string): string {
  const reference = parseModelReference(model);
  if (!reference || reference.kind === "row") {
    const modelName = model.slice(model.indexOf("/") + 1);
    return `${provider}/${modelName}`;
  }
  return `${provider}/${reference.model}`;
}

function deploymentForModel(
  deploymentMapping: Record<string, string> | null | undefined,
  model: string,
): string | null {
  if (!deploymentMapping) {
    return null;
  }

  const modelName = model.split("/").slice(1).join("/");
  return deploymentMapping[modelName] ?? deploymentMapping[model] ?? null;
}

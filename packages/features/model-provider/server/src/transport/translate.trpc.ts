/**
 * The server half of `translate.*`.
 *
 * Gated on trace-view rather than on a translate-specific permission:
 * read-only members must not be shown an action that then refuses. The
 * provider-failure policy is the application's, so what a customer reads when
 * a model call fails is the same here as everywhere else.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { ModelProviderApi, translateTrpc } from "@langwatch/model-provider-contract";

export const translateTrpcTransport = defineTrpcRouter(ModelProviderApi, translateTrpc)
  .procedure("translate")
  .withPermission("traces:view")
  .handle(({ app, input }) =>
    app.translate({ projectId: input.projectId, text: input.textToTranslate }),
  )
  .build();

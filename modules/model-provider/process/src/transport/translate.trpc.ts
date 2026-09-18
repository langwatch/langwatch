/**
 * The server half of `translate.*`. Gated on trace-view, not a
 * translate-specific permission, since read-only members must not see an
 * action that then refuses. Provider-failure policy is the app's, same everywhere.
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

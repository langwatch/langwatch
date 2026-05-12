import {
  defaultResource,
  type Resource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { type Attributes } from "@opentelemetry/api";
import * as semconv from "@opentelemetry/semantic-conventions/incubating";
import {
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_VERSION,
  DEFAULT_SERVICE_NAME,
  LANGWATCH_SDK_NAME_OBSERVABILITY,
} from "../../internal/constants";
import {
  ATTR_LANGWATCH_SDK_NAME,
  ATTR_LANGWATCH_SDK_VERSION,
  ATTR_LANGWATCH_SDK_LANGUAGE,
} from "../semconv/attributes";

/**
 * Creates a merged resource from the given attributes, service name, and given resource.
 */
export function createMergedResource(
  attributes: Attributes | undefined,
  serviceName: string | undefined,
  givenResource: Resource | undefined,
): Resource {
  const langwatchResource = resourceFromAttributes({
    [ATTR_LANGWATCH_SDK_NAME]: LANGWATCH_SDK_NAME_OBSERVABILITY,
    [ATTR_LANGWATCH_SDK_LANGUAGE]: LANGWATCH_SDK_LANGUAGE,
    [ATTR_LANGWATCH_SDK_VERSION]: LANGWATCH_SDK_VERSION,
  });

  const userResource = resourceFromAttributes({
    [semconv.ATTR_SERVICE_NAME]: serviceName ?? DEFAULT_SERVICE_NAME,
    ...(attributes ?? {}),
  });

  return (givenResource ?? defaultResource())
    .merge(langwatchResource)
    .merge(userResource);
}

/**
 * Returns the concrete OpenTelemetry provider (NodeTracerProvider or BasicTracerProvider),
 * either from the given provider or its delegate, or undefined if not found.
 */
export function getConcreteProvider(provider: unknown): unknown {
  if (!provider || typeof provider !== "object") return undefined;

  // Check provider itself
  const constructorName = (provider as any).constructor?.name;
  if (["NodeTracerProvider", "BasicTracerProvider"].includes(constructorName)) {
    return provider;
  }
  if (typeof (provider as any).addSpanProcessor === "function") {
    return provider;
  }

  // Check one level of delegate (ProxyTracerProvider pattern)
  let delegate;
  if (typeof (provider as any).getDelegate === "function") {
    delegate = (provider as any).getDelegate();
  } else if ((provider as any).delegate) {
    delegate = (provider as any).delegate;
  } else if ((provider as any)._delegate) {
    // Also check for _delegate (OpenTelemetry's actual property name)
    // See: https://github.com/langwatch/langwatch/issues/753
    delegate = (provider as any)._delegate;
  }

  if (delegate && typeof delegate === "object") {
    const delegateConstructorName = delegate.constructor?.name;
    if (["NodeTracerProvider", "BasicTracerProvider"].includes(delegateConstructorName)) {
      return delegate;
    }
    if (typeof delegate.addSpanProcessor === "function") {
      return delegate;
    }
  }

  return void 0;
}

/**
 * Returns true if the given provider (or its delegate) is a concrete OpenTelemetry provider.
 */
export function isConcreteProvider(provider: unknown): boolean {
  return !!getConcreteProvider(provider);
}


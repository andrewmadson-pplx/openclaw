import { readManifestProviderDefaultModelRef } from "openclaw/plugin-sdk/provider-catalog-shared";
import { createProviderConnectionPresetAppliers } from "openclaw/plugin-sdk/provider-onboard";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import { buildPerplexityAgentProvider } from "./provider-catalog.js";

const defaultModelRef = readManifestProviderDefaultModelRef(manifest, "perplexity-agent")!;

export const { applyConfig: applyPerplexityAgentConfig } = createProviderConnectionPresetAppliers<
  []
>({
  primaryModelRef: defaultModelRef,
  resolveParams: () => {
    const provider = buildPerplexityAgentProvider();
    return {
      providerId: "perplexity-agent",
      api: "openai-responses",
      baseUrl: provider.baseUrl,
      catalogModels: () => provider.models,
    };
  },
});

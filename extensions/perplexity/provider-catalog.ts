import { buildManifestModelProviderConfig } from "openclaw/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import manifest from "./openclaw.plugin.json" with { type: "json" };

export function buildPerplexityAgentProvider(): ModelProviderConfig {
  return buildManifestModelProviderConfig({
    providerId: "perplexity-agent",
    catalog: manifest.modelCatalog.providers["perplexity-agent"],
  });
}

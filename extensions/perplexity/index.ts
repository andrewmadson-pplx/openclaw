import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import { applyPerplexityAgentConfig } from "./onboard.js";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import { buildPerplexityAgentProvider } from "./provider-catalog.js";
import { createPerplexityWebSearchProvider } from "./src/perplexity-web-search-provider.js";
import { normalizePerplexityToolSchemas } from "./tool-schemas.js";

export default defineSingleProviderPluginEntry({
  id: "perplexity",
  name: "Perplexity Plugin",
  description: "Bundled Perplexity plugin",
  manifest,
  provider: {
    id: "perplexity-agent",
    label: "Perplexity",
    docsPath: "/providers/perplexity-provider",
    manifestAuth: {
      preserveExistingPrimary: true,
      applyConfig: applyPerplexityAgentConfig,
      noteMessage: [
        "Perplexity Agent API models use a native Perplexity API key.",
        "Get your API key at: https://www.perplexity.ai/settings/api",
      ].join("\n"),
      noteTitle: "Perplexity",
    },
    catalog: {
      buildProvider: buildPerplexityAgentProvider,
      buildStaticProvider: buildPerplexityAgentProvider,
    },
    normalizeToolSchemas: ({ tools }) => normalizePerplexityToolSchemas(tools),
  },
  register(api) {
    api.registerWebSearchProvider(createPerplexityWebSearchProvider());
  },
});
